import crypto from 'crypto';
import { Router } from 'express';

import { getAuthedUser, requireAuth, signWebAccessToken, toAuthUser } from '../auth';
import { getClientMetadataWriteData, hashAccessToken } from '../clientCompatibility';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { serializeMessage, serializeUser } from '../serializers';

export const webRoutes = Router();

const WEB_PAIRING_TTL_MS = 2 * 60 * 1000;
const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

webRoutes.post('/pairing', async (req, res, next) => {
  try {
    const secret = crypto.randomBytes(32).toString('base64url');
    const pairing = await prisma.webPairingSession.create({
      data: {
        expiresAt: new Date(Date.now() + WEB_PAIRING_TTL_MS),
        ipAddress: getRequestIp(req),
        secretHash: hashSecret(secret),
        userAgent: req.get('user-agent') ?? null,
      },
    });

    res.status(201).json({
      expiresAt: pairing.expiresAt.toISOString(),
      pairingId: pairing.id,
      secret,
      url: `meetvap://web-pair?pairingId=${encodeURIComponent(pairing.id)}&secret=${encodeURIComponent(secret)}`,
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/pairing/:pairingId', async (req, res, next) => {
  try {
    const pairingId = String(req.params.pairingId ?? '');
    const secret = getSingleQueryValue(req.query.secret);

    if (!secret) {
      throw new HttpError(400, 'Missing pairing secret');
    }

    const pairing = await prisma.webPairingSession.findFirst({
      where: {
        id: pairingId,
        secretHash: hashSecret(secret),
      },
    });

    if (!pairing || pairing.expiresAt.getTime() < Date.now()) {
      throw new HttpError(404, 'Pairing expired');
    }

    if (!pairing.tokenHash || !pairing.userId || pairing.consumedAt) {
      res.json({ status: 'pending' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: pairing.userId },
    });

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    const token = await createSingleWebSession(req, toAuthUser(user));
    req.app.get('io')?.to(`user:${user.id}`).emit('web:logged-out');

    await prisma.webPairingSession.update({
      data: { consumedAt: new Date(), tokenHash: hashAccessToken(token) },
      where: { id: pairing.id },
    });

    res.json({
      status: 'approved',
      token,
      user: serializeUser(toAuthUser(user), { revealNickname: true }),
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/pairing/:pairingId/approve', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const pairingId = String(req.params.pairingId ?? '');
    const secret = String(req.body?.secret ?? '');

    if (!secret) {
      throw new HttpError(400, 'Missing pairing secret');
    }

    const pairing = await prisma.webPairingSession.findFirst({
      where: {
        consumedAt: null,
        expiresAt: { gt: new Date() },
        id: pairingId,
        secretHash: hashSecret(secret),
      },
    });

    if (!pairing) {
      throw new HttpError(404, 'Pairing expired');
    }

    await prisma.webPairingSession.update({
      data: {
        approvedAt: new Date(),
        tokenHash: 'approved',
        userId: currentUser.id,
      },
      where: { id: pairing.id },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/devices', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const webSession = await prisma.session.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
      },
      where: {
        expiresAt: { gt: new Date() },
        platform: 'WEB',
        userId: currentUser.id,
      },
    });

    res.json({
      enabled: !!webSession,
      webSession: webSession ? {
        createdAt: webSession.createdAt.toISOString(),
        expiresAt: webSession.expiresAt.toISOString(),
        ipAddress: webSession.ipAddress,
        userAgent: webSession.userAgent,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/devices/logout', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);

    await prisma.session.deleteMany({
      where: {
        platform: 'WEB',
        userId: currentUser.id,
      },
    });

    req.app.get('io')?.to(`user:${currentUser.id}`).emit('web:logged-out');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const latestMobileToken = await prisma.devicePushToken.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { locale: true },
      where: {
        platform: { in: ['android', 'ios', 'ANDROID', 'IOS'] },
        userId: currentUser.id,
      },
    });
    const locale = latestMobileToken?.locale === 'en' ||
      latestMobileToken?.locale === 'tr' ||
      latestMobileToken?.locale === 'ru'
      ? latestMobileToken.locale
      : null;

    res.json({ locale });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/calls', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const messages = await prisma.message.findMany({
      include: {
        media: true,
        sender: {
          select: {
            avatarUrl: true,
            displayName: true,
            id: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: {
        conversation: {
          members: {
            some: {
              aliasPromptSeen: true,
              userId: currentUser.id,
            },
          },
        },
        deletedAt: null,
        kind: 'CALL',
      },
    });

    res.json({ calls: messages.map((message) => serializeMessage(message)) });
  } catch (error) {
    next(error);
  }
});

async function createSingleWebSession(req: { get: (name: string) => string | undefined; ip?: string; socket: { remoteAddress?: string } }, user: ReturnType<typeof toAuthUser>) {
  await prisma.session.deleteMany({
    where: {
      platform: 'WEB',
      userId: user.id,
    },
  });

  const token = signWebAccessToken(user);

  await prisma.session.create({
    data: {
      ...getClientMetadataWriteData({ platform: 'WEB' }),
      expiresAt: new Date(Date.now() + WEB_SESSION_TTL_MS),
      ipAddress: getRequestIp(req),
      tokenHash: hashAccessToken(token),
      userAgent: req.get('user-agent') ?? null,
      userId: user.id,
    },
  });

  return token;
}

function hashSecret(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function getSingleQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
}

function getRequestIp(req: { get: (name: string) => string | undefined; ip?: string; socket: { remoteAddress?: string } }) {
  const forwardedFor = req.get('x-forwarded-for')?.split(',')[0]?.trim();

  return forwardedFor || req.ip || req.socket.remoteAddress || null;
}
