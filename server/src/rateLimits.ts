import { HttpError } from './httpError';
import { incrementRateLimit } from './redisCache';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();
const WINDOW_MS = 60_000;

export async function enforceRateLimit(userId: string, action: string, maximum: number) {
  const now = Date.now();
  const key = `${userId}:${action}`;
  const redisResult = await incrementRateLimit(`rate:${key}`, WINDOW_MS / 1000);

  if (redisResult) {
    if (redisResult.count > maximum) {
      throw new HttpError(429, 'Too many requests. Please wait before trying again.', {
        code: 'RATE_LIMITED',
        retryAfterSeconds: redisResult.retryAfterSeconds,
      });
    }

    return;
  }

  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  if (current.count >= maximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new HttpError(429, 'Too many requests. Please wait before trying again.', {
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    });
  }

  current.count += 1;
}

export function pruneRateLimitBuckets() {
  const now = Date.now();

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
