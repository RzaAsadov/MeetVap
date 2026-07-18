import { prisma } from './prisma';
import { cacheDeletePattern, cacheGetJson, cacheSetJson } from './redisCache';

const PUSH_TOKEN_CACHE_TTL_SECONDS = 300;

export type CachedPushToken = {
  locale: string | null;
  platform: string;
  provider: string;
  token: string;
  userId?: string;
};

export async function getCachedPushTokensForUsers(userIds: string[], includeUserId = false) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean).sort();

  if (uniqueUserIds.length === 0) {
    return [];
  }

  const cacheKey = `push-tokens:${includeUserId ? 'with-user' : 'basic'}:${uniqueUserIds.join(',')}`;
  const cached = await cacheGetJson<CachedPushToken[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const tokens = await prisma.devicePushToken.findMany({
    select: {
      locale: true,
      platform: true,
      provider: true,
      token: true,
      ...(includeUserId ? { userId: true } : {}),
    },
    where: { userId: { in: uniqueUserIds } },
  });

  await cacheSetJson(cacheKey, tokens, PUSH_TOKEN_CACHE_TTL_SECONDS);
  return tokens;
}

export async function invalidatePushTokenCacheForUser(userId: string) {
  await Promise.all([
    cacheDeletePattern(`push-tokens:basic:*${userId}*`),
    cacheDeletePattern(`push-tokens:with-user:*${userId}*`),
  ]);
}
