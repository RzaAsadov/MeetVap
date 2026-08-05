export function isIncomingCallUrlExpired(rawExpiresAt: string | null, now = Date.now()) {
  // Older native iOS call URLs did not include expiresAt. Their native
  // answered-call marker has its own short TTL, so absence is not expiration.
  if (rawExpiresAt === null || rawExpiresAt.trim() === '') {
    return false;
  }

  const expiresAt = Number(rawExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
