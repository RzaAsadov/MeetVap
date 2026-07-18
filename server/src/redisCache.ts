import { createClient, RedisClientType } from 'redis';

import { config } from './config';

let redisClient: RedisClientType | null = null;
let redisConnectPromise: Promise<RedisClientType | null> | null = null;
let redisDisabledUntil = 0;
let lastRedisWarningAt = 0;

const REDIS_RETRY_BACKOFF_MS = 30_000;
const REDIS_WARNING_THROTTLE_MS = 60_000;

export function isRedisConfigured() {
  return !!config.REDIS_URL;
}

async function getRedisClient() {
  if (!config.REDIS_URL || Date.now() < redisDisabledUntil) {
    return null;
  }

  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (redisConnectPromise) {
    return redisConnectPromise;
  }

  redisConnectPromise = (async () => {
    try {
      const client = createClient({ url: config.REDIS_URL });

      client.on('error', (error) => {
        warnRedis('Redis client error', error);
      });

      await client.connect();
      redisClient = client as RedisClientType;
      return redisClient;
    } catch (error) {
      redisClient = null;
      redisDisabledUntil = Date.now() + REDIS_RETRY_BACKOFF_MS;
      warnRedis('Redis unavailable, using database fallback', error);
      return null;
    } finally {
      redisConnectPromise = null;
    }
  })();

  return redisConnectPromise;
}

export async function cacheGetJson<T>(key: string) {
  const client = await getRedisClient();

  if (!client) {
    return null;
  }

  try {
    const raw = await client.get(key);

    return raw ? JSON.parse(raw) as T : null;
  } catch (error) {
    warnRedis('Redis get failed', error);
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number) {
  const client = await getRedisClient();

  if (!client || ttlSeconds <= 0) {
    return;
  }

  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (error) {
    warnRedis('Redis set failed', error);
  }
}

export async function cacheDelete(...keys: string[]) {
  const client = await getRedisClient();
  const uniqueKeys = [...new Set(keys.filter(Boolean))];

  if (!client || uniqueKeys.length === 0) {
    return;
  }

  try {
    await client.del(uniqueKeys);
  } catch (error) {
    warnRedis('Redis delete failed', error);
  }
}

export async function cacheDeletePattern(pattern: string) {
  const client = await getRedisClient();

  if (!client) {
    return;
  }

  try {
    const keys: string[] = [];

    for await (const key of client.scanIterator({ COUNT: 100, MATCH: pattern })) {
      keys.push(String(key));

      if (keys.length >= 100) {
        await client.del(keys.splice(0, keys.length));
      }
    }

    if (keys.length > 0) {
      await client.del(keys);
    }
  } catch (error) {
    warnRedis('Redis pattern delete failed', error);
  }
}

export async function incrementRateLimit(key: string, windowSeconds: number) {
  const client = await getRedisClient();

  if (!client) {
    return null;
  }

  try {
    const count = await client.incr(key);

    if (count === 1) {
      await client.expire(key, windowSeconds);
    }

    const ttl = await client.ttl(key);

    return {
      count,
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (error) {
    warnRedis('Redis rate limit failed', error);
    return null;
  }
}

export async function withRedisLock<T>(
  key: string,
  ttlSeconds: number,
  task: () => Promise<T>,
) {
  const client = await getRedisClient();

  if (!client) {
    return task();
  }

  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await client.set(key, token, { EX: ttlSeconds, NX: true }).catch((error) => {
    warnRedis('Redis lock failed', error);
    return null;
  });

  if (acquired !== 'OK') {
    return undefined;
  }

  try {
    return await task();
  } finally {
    await releaseRedisLock(key, token);
  }
}

async function releaseRedisLock(key: string, token: string) {
  const client = await getRedisClient();

  if (!client) {
    return;
  }

  try {
    await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      { arguments: [token], keys: [key] },
    );
  } catch (error) {
    warnRedis('Redis lock release failed', error);
  }
}

function warnRedis(message: string, error: unknown) {
  if (Date.now() - lastRedisWarningAt < REDIS_WARNING_THROTTLE_MS) {
    return;
  }

  lastRedisWarningAt = Date.now();
  console.warn(message, error instanceof Error ? error.message : error);
}
