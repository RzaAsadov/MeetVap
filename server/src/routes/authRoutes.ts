import { Request, Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { getAuthedUser, hashPassword, isAdminBlocked, requireAuth, signAccessToken, toAuthUser, verifyPassword } from '../auth';
import { getClientMetadataWriteData, getRequestClientMetadata, hashAccessToken } from '../clientCompatibility';
import { enqueueChildUserSync } from '../childUserSync';
import { assertRequestDeviceAllowed } from '../deviceAccess';
import { HttpError } from '../httpError';
import { operationalConfig } from '../operationalConfig';
import { prisma } from '../prisma';
import { getPublicApiUrlForRequest } from '../publicApiEndpoints';
import { enforceRateLimit } from '../rateLimits';
import { serializeUser } from '../serializers';
import { notifyServerUserRegistered } from '../serverEventMessages';
import { ensureUserPublicShareCode } from '../shareCodes';
import { CURRENT_TERMS_VERSION } from '../terms';
import { loginSchema, registerSchema, usernameAvailabilitySchema } from '../validators';

export const authRoutes = Router();

const domainResolutionSchema = z.object({
  domain: z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
  platform: z.string().trim().max(32).optional(),
  username: z.string().trim().toLowerCase().min(1).max(32).regex(/^[a-z0-9_]+$/),
});

authRoutes.post('/domain-resolution', async (req, res, next) => {
  try {
    if (operationalConfig.serverRole !== 'main') {
      throw new HttpError(404, 'Route not found');
    }

    const input = domainResolutionSchema.parse(req.body);
    await enforceRateLimit(`${getRequestIp(req)}:${input.domain}`, 'domain-resolution', 30);

    const result = await prisma.$transaction(async (tx) => {
      const domain = await tx.loginDomain.findUnique({ where: { domain: input.domain } });

      if (!domain) throw new HttpError(404, 'Login domain not found', { code: 'LOGIN_DOMAIN_NOT_FOUND' });
      if (!domain.isActive) throw new HttpError(403, 'Login domain is inactive', { code: 'LOGIN_DOMAIN_INACTIVE' });
      if (domain.expiresAt && domain.expiresAt <= new Date()) {
        throw new HttpError(403, 'Login domain has expired', { code: 'LOGIN_DOMAIN_EXPIRED' });
      }

      const existing = await tx.loginDomainUsername.findUnique({
        where: { domainId_username: { domainId: domain.id, username: input.username } },
      });

      if (!existing && domain.maxUserCount !== null) {
        const allocated = await tx.loginDomainUsername.count({ where: { domainId: domain.id } });
        if (allocated >= domain.maxUserCount) {
          throw new HttpError(403, 'Login domain user limit reached', { code: 'LOGIN_DOMAIN_LIMIT_REACHED' });
        }
      }

      await tx.loginDomainUsername.upsert({
        create: { domainId: domain.id, platform: input.platform, username: input.username },
        update: { lastRequestedAt: new Date(), platform: input.platform, requestCount: { increment: 1 } },
        where: { domainId_username: { domainId: domain.id, username: input.username } },
      });

      return domain;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      domain: result.domain,
      expiresAt: result.expiresAt?.toISOString() ?? null,
      hostname: result.hostname,
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.get('/username-availability', async (req, res, next) => {
  try {
    const input = usernameAvailabilitySchema.parse({
      username: typeof req.query.username === 'string' ? req.query.username : '',
    });
    const existing = await prisma.user.findUnique({
      select: { id: true },
      where: { username: input.username },
    });

    res.json({
      available: !existing,
      username: input.username,
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/register', async (req, res, next) => {
  try {
    await assertRequestDeviceAllowed(req, { required: true });
    const input = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
    });

    if (existing) {
      throw new HttpError(409, 'Username is already taken');
    }

    const user = await prisma.user.create({
      data: {
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        registrationIpAddress: getRequestIp(req),
        registrationLocale: input.locale,
        registrationPlatform: input.platform,
        registrationUserAgent: req.get('user-agent') ?? null,
        hideNickname: false,
        termsAcceptedAt: new Date(),
        termsAcceptedIpAddress: getRequestIp(req),
        termsAcceptedLocale: input.locale,
        termsAcceptedPlatform: input.platform,
        termsVersion: CURRENT_TERMS_VERSION,
        useGroupAliases: true,
        username: input.username,
      },
      select: {
        avatarUrl: true,
        authVersion: true,
        displayName: true,
        hideFromSearch: true,
        hideNickname: true,
        id: true,
        lastSeenAt: true,
        onlyContactsCanCall: true,
        registrationIpAddress: true,
        registrationLocale: true,
        registrationPlatform: true,
        registrationUserAgent: true,
        showLastSeen: true,
        useGroupAliases: true,
        username: true,
      },
    });
    const publicShareCode = await ensureUserPublicShareCode(user.id);
    const token = signAccessToken(user);
    const clientMetadata = getRequestClientMetadata(req, input.platform);

    await prisma.session.create({
      data: {
        ...getClientMetadataWriteData(clientMetadata),
        expiresAt: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
        ipAddress: getRequestIp(req),
        locale: input.locale,
        platform: input.platform,
        publicApiUrl: getPublicApiUrlForRequest(req),
        tokenHash: hashAccessToken(token),
        userAgent: req.get('user-agent') ?? null,
        userId: user.id,
      },
    });
    void enqueueChildUserSync(user.id, 'REGISTERED').catch((error) => {
      console.error('Could not queue registered child user synchronization', { error, userId: user.id });
    });
    if (operationalConfig.serverRole === 'main') {
      void notifyServerUserRegistered({
        io: req.app.get('io'),
        occurredAt: new Date(),
        platform: input.platform,
        user,
      }).catch((error) => {
        console.warn('Could not send registration server event', error);
      });
    }

    res.status(201).json({
      token,
      user: { ...serializeUser({ ...user, publicShareCode }, { revealNickname: true }), preventPeerScreenshots: true },
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    await assertRequestDeviceAllowed(req, { required: true });
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { username: input.username },
    });

    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid username or password');
    }

    if (await isAdminBlocked(user.id)) {
      throw new HttpError(403, 'This account is blocked');
    }

    await prisma.user.update({
      data: {
        termsAcceptedAt: new Date(),
        termsAcceptedIpAddress: getRequestIp(req),
        termsAcceptedLocale: input.locale,
        termsAcceptedPlatform: input.platform,
        termsVersion: CURRENT_TERMS_VERSION,
      },
      where: { id: user.id },
    });

    const authUser = {
      ...toAuthUser(user),
      preventPeerScreenshots: await getPreventPeerScreenshots(user.id),
      publicShareCode: await ensureUserPublicShareCode(user.id),
    };
    const token = signAccessToken(authUser);
    const clientMetadata = getRequestClientMetadata(req, input.platform);

    await prisma.session.create({
      data: {
        ...getClientMetadataWriteData(clientMetadata),
        expiresAt: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
        ipAddress: getRequestIp(req),
        locale: input.locale,
        platform: input.platform,
        publicApiUrl: getPublicApiUrlForRequest(req),
        tokenHash: hashAccessToken(token),
        userAgent: req.get('user-agent') ?? null,
        userId: user.id,
      },
    });
    void enqueueChildUserSync(user.id, 'LOGIN').catch((error) => {
      console.error('Could not queue logged-in child user synchronization', { error, userId: user.id });
    });

    res.json({
      token,
      user: serializeUser(authUser, { revealNickname: true }),
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.get('/me', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);

    res.json({
      user: {
        ...serializeUser({
          ...currentUser,
          publicShareCode: currentUser.publicShareCode ?? await ensureUserPublicShareCode(currentUser.id),
        }, { revealNickname: true }),
        preventPeerScreenshots: await getPreventPeerScreenshots(currentUser.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

async function getPreventPeerScreenshots(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ preventPeerScreenshots: boolean }>>`
    select "preventPeerScreenshots" from "User" where "id" = ${userId} limit 1
  `;

  return rows[0]?.preventPeerScreenshots !== false;
}

function getRequestIp(req: Request) {
  const forwardedFor = req.get('x-forwarded-for')?.split(',')[0]?.trim();

  return forwardedFor || req.ip || req.socket.remoteAddress || null;
}
