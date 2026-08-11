import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { assertRequestAttestationAccess } from './attestationAccess';
import { getRequestMessageClient, recordUserClientActivity } from './clientActivity';
import { recordSessionClientMetadata } from './clientCompatibility';
import { config } from './config';
import { assertRequestDeviceAllowed } from './deviceAccess';
import { HttpError } from './httpError';
import { prisma } from './prisma';
import { cacheDelete, cacheGetJson, cacheSetJson } from './redisCache';
import { AuthUser, JwtPayload } from './types';

const TOKEN_EXPIRES_IN = '30d';
const AUTH_CACHE_TTL_SECONDS = 45;
const ADMIN_BLOCK_CACHE_TTL_SECONDS = 60;

export function toAuthUser(user: AuthUser): AuthUser {
  return {
    authVersion: user.authVersion ?? 0,
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
      authVersion: user.authVersion ?? 0,
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
      authVersion: user.authVersion ?? 0,
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
    await assertRequestDeviceAllowed(req);
    const authState = await getUserAuthState(payload.sub);

    if (!authState.exists) {
      throw new HttpError(401, 'User not found');
    }

    if (authState.blocked) {
      throw new HttpError(403, 'This account is blocked', { code: 'ACCOUNT_BLOCKED' });
    }

    if ((payload.authVersion ?? 0) !== authState.authVersion) {
      throw new HttpError(401, 'Session revoked', { code: 'SESSION_REVOKED' });
    }
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
      await assertRequestAttestationAccess(req, cachedUser.id, tokenHash);
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
        authVersion: true,
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
    await assertRequestAttestationAccess(req, user.id, tokenHash);
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
  return (await getUserAuthState(userId)).blocked;
}

export async function getUserAuthState(userId: string) {
  const cacheKey = `user-auth-state:${userId}`;
  const cached = await cacheGetJson<UserAuthState>(cacheKey);

  if (cached) {
    return cached;
  }

  const user = await prisma.user.findUnique({
    select: {
      adminBlock: { select: { userId: true } },
      authVersion: true,
      id: true,
    },
    where: { id: userId },
  });
  const state: UserAuthState = {
    authVersion: user?.authVersion ?? 0,
    blocked: !!user?.adminBlock,
    exists: !!user,
  };

  await cacheSetJson(cacheKey, state, ADMIN_BLOCK_CACHE_TTL_SECONDS);
  return state;
}

export async function cacheUserAuthState(userId: string, state: UserAuthState) {
  await Promise.all([
    cacheSetJson(`user-auth-state:${userId}`, state, ADMIN_BLOCK_CACHE_TTL_SECONDS),
    cacheSetJson(`admin-blocked:${userId}`, { blocked: state.blocked }, ADMIN_BLOCK_CACHE_TTL_SECONDS),
  ]);
}

export async function invalidateUserAuthCache(userId: string, tokenHashes: string[] = []) {
  await cacheDelete(
    `admin-blocked:${userId}`,
    `user-auth-state:${userId}`,
    ...tokenHashes.map((tokenHash) => `auth:${tokenHash}`),
  );
}

type UserAuthState = {
  authVersion: number;
  blocked: boolean;
  exists: boolean;
};

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
