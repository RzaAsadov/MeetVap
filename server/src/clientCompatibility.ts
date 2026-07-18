import crypto from 'crypto';
import { Request } from 'express';

import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';

const APP_VERSION_HEADER = 'x-meetvap-app-version';
const BUILD_NUMBER_HEADER = 'x-meetvap-build-number';
const CAPABILITIES_HEADER = 'x-meetvap-capabilities';
const PLATFORM_HEADER = 'x-meetvap-platform';
const MAX_HEADER_LENGTH = 64;
const MAX_CAPABILITIES_HEADER_LENGTH = 256;
const SESSION_METADATA_WRITE_TTL_MS = 10 * 60 * 1000;
const SESSION_METADATA_CACHE_MAX = 5000;
const recentSessionMetadataWrites = new Map<string, { signature: string; writtenAt: number }>();

export const LIVEKIT_POOL_CAPABILITY = 'livekit-pool';
export const APP_ATTESTATION_CAPABILITY = 'app-attestation';

type ClientPlatform = 'android' | 'ios';

type ClientMetadata = {
  appBuildNumber?: number;
  appVersion?: string;
  capabilities?: string[];
  platform?: string;
};

type ClientRow = {
  appBuildNumber: number | null;
  capabilities: string[];
  platform: string | null;
  userId: string;
};

export function getRequestClientMetadata(req: Request, fallbackPlatform?: string | null): ClientMetadata {
  const appVersion = normalizeHeaderValue(req.get(APP_VERSION_HEADER));
  const appBuildNumber = normalizeBuildNumber(req.get(BUILD_NUMBER_HEADER));
  const capabilities = normalizeCapabilities(req.get(CAPABILITIES_HEADER));
  const platform = normalizeHeaderValue(req.get(PLATFORM_HEADER)) ?? normalizeHeaderValue(fallbackPlatform);

  return {
    ...(appBuildNumber ? { appBuildNumber } : {}),
    ...(appVersion ? { appVersion } : {}),
    capabilities,
    ...(platform ? { platform } : {}),
  };
}

export function hasClientMetadata(input: ClientMetadata) {
  return input.appBuildNumber !== undefined ||
    input.appVersion !== undefined ||
    input.capabilities !== undefined ||
    input.platform !== undefined;
}

export function hasClientCapability(input: ClientMetadata, capability: string) {
  return input.capabilities?.includes(capability) === true;
}

export function hashAccessToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function recordSessionClientMetadata(
  req: Request,
  userId: string,
  token: string,
  expiresAt?: Date,
) {
  const metadata = getRequestClientMetadata(req);

  if (!hasClientMetadata(metadata)) {
    return;
  }

  const tokenHash = hashAccessToken(token);
  const data = getClientMetadataWriteData(metadata);
  const signature = JSON.stringify(data);
  const cachedWrite = recentSessionMetadataWrites.get(tokenHash);
  const now = Date.now();

  if (cachedWrite?.signature === signature && now - cachedWrite.writtenAt < SESSION_METADATA_WRITE_TTL_MS) {
    return;
  }

  const result = await prisma.session.updateMany({
    data,
    where: {
      tokenHash,
      userId,
    },
  });

  if (result.count > 0) {
    rememberSessionMetadataWrite(tokenHash, signature);
    return;
  }

  await prisma.session.create({
    data: {
      ...data,
      expiresAt: expiresAt ?? new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
      ipAddress: getRequestIp(req),
      tokenHash,
      userAgent: req.get('user-agent') ?? null,
      userId,
    },
  });
  rememberSessionMetadataWrite(tokenHash, signature);
}

function rememberSessionMetadataWrite(tokenHash: string, signature: string) {
  recentSessionMetadataWrites.set(tokenHash, {
    signature,
    writtenAt: Date.now(),
  });

  if (recentSessionMetadataWrites.size <= SESSION_METADATA_CACHE_MAX) {
    return;
  }

  const cutoff = Date.now() - SESSION_METADATA_WRITE_TTL_MS;

  for (const [key, value] of recentSessionMetadataWrites) {
    if (value.writtenAt <= cutoff || recentSessionMetadataWrites.size > SESSION_METADATA_CACHE_MAX) {
      recentSessionMetadataWrites.delete(key);
    }

    if (recentSessionMetadataWrites.size <= SESSION_METADATA_CACHE_MAX) {
      break;
    }
  }
}

export function getClientMetadataWriteData(metadata: ClientMetadata) {
  return {
    ...(metadata.appBuildNumber !== undefined ? { appBuildNumber: metadata.appBuildNumber } : {}),
    ...(metadata.appVersion !== undefined ? { appVersion: metadata.appVersion } : {}),
    ...(metadata.capabilities !== undefined ? { capabilities: metadata.capabilities } : {}),
    ...(metadata.platform !== undefined ? { platform: metadata.platform } : {}),
  };
}

export async function areUsersHardDeleteReady(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);

  if (uniqueUserIds.length === 0) {
    return false;
  }

  const activePushTokenCutoff = new Date(Date.now() - operationalConfig.messageQueue.activePushTokenDays * 24 * 60 * 60 * 1000);
  const [sessions, pushTokens] = await Promise.all([
    prisma.session.findMany({
      select: { appBuildNumber: true, capabilities: true, platform: true, userId: true },
      where: {
        expiresAt: { gt: new Date() },
        userId: { in: uniqueUserIds },
      },
    }),
    prisma.devicePushToken.findMany({
      select: { appBuildNumber: true, capabilities: true, platform: true, userId: true },
      where: {
        updatedAt: { gte: activePushTokenCutoff },
        userId: { in: uniqueUserIds },
      },
    }),
  ]);
  const rowsByUserId = new Map<string, ClientRow[]>();

  [...sessions, ...pushTokens].forEach((row) => {
    const rows = rowsByUserId.get(row.userId) ?? [];
    rows.push(row);
    rowsByUserId.set(row.userId, rows);
  });

  return uniqueUserIds.every((userId) => {
    const rows = rowsByUserId.get(userId) ?? [];

    return rows.length > 0 && rows.every(isHardDeleteReadyClientRow);
  });
}

function isHardDeleteReadyClientRow(row: ClientRow) {
  const platform = normalizeClientPlatform(row.platform);

  if (!platform || !row.appBuildNumber) {
    return false;
  }

  return row.appBuildNumber >= operationalConfig.messageQueue.hardDeleteMinBuild[platform];
}

function normalizeClientPlatform(platform?: string | null): ClientPlatform | null {
  const normalized = platform?.trim().toLowerCase();

  if (normalized === 'android' || normalized === 'ios') {
    return normalized;
  }

  return null;
}

function normalizeBuildNumber(value?: string | null) {
  const normalized = normalizeHeaderValue(value);

  if (!normalized || !/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeHeaderValue(value?: string | null) {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, MAX_HEADER_LENGTH) : undefined;
}

function normalizeCapabilities(value?: string | null) {
  const normalized = value?.trim();

  if (!normalized) {
    return [];
  }

  const capabilitySet = new Set<string>();

  normalized
    .slice(0, MAX_CAPABILITIES_HEADER_LENGTH)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .forEach((item) => {
      if (item === LIVEKIT_POOL_CAPABILITY || item === APP_ATTESTATION_CAPABILITY) {
        capabilitySet.add(item);
      }
    });

  return [...capabilitySet];
}

function getRequestIp(req: Request) {
  const forwardedFor = req.get('x-forwarded-for')?.split(',')[0]?.trim();

  return forwardedFor || req.ip || req.socket.remoteAddress || null;
}

// TODO-MEETVAP-REMOVE-LEGACY-MESSAGE-QUEUE:
// Remove the old-client compatibility branch after all active clients send build headers
// and hard-delete-ready builds have been mandatory for at least 60 days.
