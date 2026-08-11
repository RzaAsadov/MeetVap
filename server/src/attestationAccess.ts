import { Request } from 'express';

import { APP_ATTESTATION_CAPABILITY } from './clientCompatibility';
import { HttpError } from './httpError';
import { AttestationPlatform, getAttestationMode, operationalConfig } from './operationalConfig';
import { prisma } from './prisma';
import { cacheDelete, cacheGetJson, cacheSetJson } from './redisCache';

const ACCESS_CACHE_TTL_SECONDS = 30;

type CachedAttestationAccess = {
  activeTrustedExpiresAt: string | null;
  appBuildNumber: number | null;
  attestationGraceStartedAt: string | null;
  capabilities: string[];
  latestFailureReason: string | null;
  latestStatus: string | null;
  platform: string | null;
  sessionId: string;
};

export type AttestationAccessDecision = {
  allowed: boolean;
  code?: 'APP_INTEGRITY_UNTRUSTED' | 'APP_UPDATE_REQUIRED' | 'ATTESTATION_REQUIRED';
  graceExpiresAt?: string;
  message?: string;
  mode?: 'enforce' | 'observe' | 'soft';
  platform?: AttestationPlatform;
  retryAfterSeconds?: number;
};

export async function assertRequestAttestationAccess(req: Request, userId: string, tokenHash: string) {
  if (req.baseUrl === '/attestation' || req.originalUrl.startsWith('/attestation/')) {
    return;
  }

  const decision = await getSessionAttestationAccessDecision(userId, tokenHash);

  if (decision.allowed) {
    return;
  }

  throw new HttpError(428, decision.message ?? 'App integrity verification is required', {
    code: decision.code,
    graceExpiresAt: decision.graceExpiresAt,
    mode: decision.mode,
    platform: decision.platform,
    retryAfterSeconds: decision.retryAfterSeconds,
  });
}

export async function getSessionAttestationAccessDecision(
  userId: string,
  tokenHash: string,
): Promise<AttestationAccessDecision> {
  const access = await getCachedAttestationAccess(userId, tokenHash);

  if (!access) {
    return { allowed: true };
  }

  const platform = normalizePlatform(access.platform);

  if (!platform) {
    return { allowed: true };
  }

  const mode = getAttestationMode(platform);

  if (mode !== 'enforce') {
    return { allowed: true, mode, platform };
  }

  const now = Date.now();
  const graceStartedAt = access.attestationGraceStartedAt
    ? new Date(access.attestationGraceStartedAt)
    : new Date(now);

  if (!access.attestationGraceStartedAt) {
    await prisma.session.updateMany({
      data: { attestationGraceStartedAt: graceStartedAt },
      where: {
        attestationGraceStartedAt: null,
        id: access.sessionId,
        tokenHash,
        userId,
      },
    });
    access.attestationGraceStartedAt = graceStartedAt.toISOString();
    await cacheSetJson(getAccessCacheKey(tokenHash), access, ACCESS_CACHE_TTL_SECONDS);
  }

  const graceExpiresAtMs = graceStartedAt.getTime() +
    operationalConfig.attestation.bootstrapGraceMinutes * 60_000;
  const graceExpiresAt = new Date(graceExpiresAtMs).toISOString();

  if (now <= graceExpiresAtMs) {
    return { allowed: true, graceExpiresAt, mode, platform };
  }

  if (access.activeTrustedExpiresAt && new Date(access.activeTrustedExpiresAt).getTime() > now) {
    return { allowed: true, mode, platform };
  }

  const hasAttestationCapability = access.capabilities.includes(APP_ATTESTATION_CAPABILITY);
  const requiredBuild = platform === 'android'
    ? operationalConfig.attestation.androidRequiredBuild
    : operationalConfig.attestation.iosRequiredBuild;
  const buildRequiresAttestation = access.appBuildNumber !== null && access.appBuildNumber >= requiredBuild;

  if (!hasAttestationCapability && !buildRequiresAttestation) {
    const legacyAllowUntil = operationalConfig.attestation.legacyAllowUntil
      ? new Date(operationalConfig.attestation.legacyAllowUntil).getTime()
      : 0;

    if (legacyAllowUntil > now) {
      return { allowed: true, mode, platform };
    }

    return {
      allowed: false,
      code: 'APP_UPDATE_REQUIRED',
      graceExpiresAt,
      message: 'Update MeetVap to continue',
      mode,
      platform,
    };
  }

  const isRetryable = !access.latestStatus ||
    access.latestStatus === 'PENDING' ||
    access.latestFailureReason === 'app_integrity_unevaluated';

  return {
    allowed: false,
    code: isRetryable ? 'ATTESTATION_REQUIRED' : 'APP_INTEGRITY_UNTRUSTED',
    graceExpiresAt,
    message: isRetryable
      ? 'App integrity verification is still pending'
      : 'This app installation or device did not pass integrity verification',
    mode,
    platform,
    retryAfterSeconds: isRetryable
      ? operationalConfig.attestation.unevaluatedRetryAfterSeconds
      : undefined,
  };
}

export async function invalidateAttestationAccess(tokenHash?: string | null) {
  if (tokenHash) {
    await cacheDelete(getAccessCacheKey(tokenHash));
  }
}

async function getCachedAttestationAccess(userId: string, tokenHash: string) {
  const cacheKey = getAccessCacheKey(tokenHash);
  const cached = await cacheGetJson<CachedAttestationAccess>(cacheKey);

  if (cached) {
    return cached;
  }

  const session = await prisma.session.findFirst({
    select: {
      appBuildNumber: true,
      attestationGraceStartedAt: true,
      capabilities: true,
      id: true,
      platform: true,
    },
    where: {
      expiresAt: { gt: new Date() },
      tokenHash,
      userId,
    },
  });

  if (!session) {
    return null;
  }

  const [activeTrusted, latest] = await Promise.all([
    prisma.deviceAttestation.findFirst({
      orderBy: { lastAttestedAt: 'desc' },
      select: { expiresAt: true },
      where: {
        expiresAt: { gt: new Date() },
        sessionId: session.id,
        status: 'TRUSTED',
        userId,
      },
    }),
    prisma.deviceAttestation.findFirst({
      orderBy: { lastAttestedAt: 'desc' },
      select: { failureReason: true, status: true },
      where: { sessionId: session.id, userId },
    }),
  ]);
  const access: CachedAttestationAccess = {
    activeTrustedExpiresAt: activeTrusted?.expiresAt?.toISOString() ?? null,
    appBuildNumber: session.appBuildNumber,
    attestationGraceStartedAt: session.attestationGraceStartedAt?.toISOString() ?? null,
    capabilities: session.capabilities,
    latestFailureReason: latest?.failureReason ?? null,
    latestStatus: latest?.status ?? null,
    platform: session.platform,
    sessionId: session.id,
  };

  await cacheSetJson(cacheKey, access, ACCESS_CACHE_TTL_SECONDS);
  return access;
}

function normalizePlatform(value?: string | null): AttestationPlatform | null {
  const normalized = value?.trim().toLowerCase();

  return normalized === 'android' || normalized === 'ios' ? normalized : null;
}

function getAccessCacheKey(tokenHash: string) {
  return `attestation-access:${tokenHash}`;
}
