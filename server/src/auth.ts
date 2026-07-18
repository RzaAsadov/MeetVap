import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { getRequestMessageClient, recordUserClientActivity } from './clientActivity';
import { recordSessionClientMetadata } from './clientCompatibility';
import { config } from './config';
import { HttpError } from './httpError';
import { prisma } from './prisma';
import { cacheDelete, cacheGetJson, cacheSetJson } from './redisCache';
import { AuthUser, JwtPayload } from './types';

const TOKEN_EXPIRES_IN = '30d';
const AUTH_CACHE_TTL_SECONDS = 45;
const ADMIN_BLOCK_CACHE_TTL_SECONDS = 60;

export function toAuthUser(user: AuthUser): AuthUser {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName,
    hideFromSearch: user.hideFromSearch,
    hideNickname: user.hideNickname,
    id: user.id,
    lastSeenAt: user.lastSeenAt,
    onlyContactsCanCall: user.onlyContactsCanCall,
    preventPeerScreenshots: user.preventPeerScreenshots !== false,
    publicShareCode: user.publicShareCode,
    showLastSeen: user.showLastSeen,
    useGroupAliases: user.useGroupAliases,
    username: user.username,
  };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAccessToken(user: AuthUser) {
  return jwt.sign(
    {
      username: user.username,
    },
    config.JWT_SECRET,
    {
      expiresIn: TOKEN_EXPIRES_IN,
      subject: user.id,
    },
  );
}

export function signWebAccessToken(user: AuthUser) {
  return jwt.sign(
    {
      scope: 'web',
      username: user.username,
    },
    config.JWT_SECRET,
    {
      expiresIn: TOKEN_EXPIRES_IN,
      subject: user.id,
    },
  );
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    const messageClient = getRequestMessageClient(req, payload);
    const tokenHash = hashToken(token);
    const authCacheKey = `auth:${tokenHash}`;
    const cachedAuth = await cacheGetJson<{ user: CachedAuthUser }>(authCacheKey);

    if (cachedAuth?.user) {
      const cachedUser = hydrateCachedAuthUser(cachedAuth.user);

      await recordSessionClientMetadata(
        req,
        cachedUser.id,
        token,
        payload.exp ? new Date(payload.exp * 1000) : undefined,
      );
      void recordUserClientActivity(cachedUser.id, messageClient);
      req.messageClient = messageClient;
      req.user = cachedUser;
      next();
      return;
    }

    if (payload.scope === 'web') {
      const session = await prisma.session.findFirst({
        select: { id: true },
        where: {
          expiresAt: { gt: new Date() },
          platform: 'WEB',
          tokenHash,
          userId: payload.sub,
        },
      });

      if (!session) {
        throw new HttpError(401, 'Web session expired');
      }
    }
    const user = await prisma.user.findUnique({
      select: {
        avatarUrl: true,
        displayName: true,
        hideFromSearch: true,
        hideNickname: true,
        id: true,
        lastSeenAt: true,
        onlyContactsCanCall: true,
        showLastSeen: true,
        useGroupAliases: true,
        username: true,
      },
      where: { id: payload.sub },
    });

    if (!user) {
      throw new HttpError(401, 'User not found');
    }

    if (await isAdminBlocked(user.id)) {
      throw new HttpError(403, 'This account is blocked');
    }

    await cacheSetJson(authCacheKey, { user: serializeCachedAuthUser(user) }, getAuthCacheTtlSeconds(payload));
    await recordSessionClientMetadata(
      req,
      user.id,
      token,
      payload.exp ? new Date(payload.exp * 1000) : undefined,
    );
    void recordUserClientActivity(user.id, messageClient);
    req.messageClient = messageClient;
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Invalid token'));
  }
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getAuthedUser(req: Request) {
  if (!req.user) {
    throw new HttpError(401, 'Not authenticated');
  }

  return req.user;
}

export async function isAdminBlocked(userId: string) {
  const cacheKey = `admin-blocked:${userId}`;
  const cached = await cacheGetJson<{ blocked: boolean }>(cacheKey);

  if (cached) {
    return cached.blocked;
  }

  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    select "userId" from "AdminBlockedUser" where "userId" = ${userId} limit 1
  `;

  const blocked = rows.length > 0;

  await cacheSetJson(cacheKey, { blocked }, ADMIN_BLOCK_CACHE_TTL_SECONDS);
  return blocked;
}

export async function invalidateUserAuthCache(userId: string) {
  await cacheDelete(`admin-blocked:${userId}`);
}

type CachedAuthUser = Omit<AuthUser, 'lastSeenAt'> & {
  lastSeenAt?: string | null;
};

function serializeCachedAuthUser(user: AuthUser): CachedAuthUser {
  return {
    ...user,
    lastSeenAt: user.lastSeenAt?.toISOString?.() ?? null,
  };
}

function hydrateCachedAuthUser(user: CachedAuthUser): AuthUser {
  return {
    ...user,
    lastSeenAt: user.lastSeenAt ? new Date(user.lastSeenAt) : undefined,
  };
}

function getAuthCacheTtlSeconds(payload: JwtPayload) {
  if (!payload.exp) {
    return AUTH_CACHE_TTL_SECONDS;
  }

  return Math.max(1, Math.min(AUTH_CACHE_TTL_SECONDS, payload.exp - Math.floor(Date.now() / 1000)));
}
