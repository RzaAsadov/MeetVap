export function getPushRetryDelayMs(attemptCount: number, maxRetrySeconds: number, random = Math.random()) {
  const seconds = Math.min(maxRetrySeconds, 2 ** Math.min(attemptCount, 10));
  return Math.round(seconds * (0.8 + random * 0.4) * 1000);
}
