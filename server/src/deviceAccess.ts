import crypto from 'crypto';
import { Request } from 'express';

import { normalizeInstallationId } from './clientActivity';
import { config } from './config';
import { HttpError } from './httpError';
import { prisma } from './prisma';
import { cacheDelete, cacheGetJson, cacheSetJson } from './redisCache';

export type DeviceIdentifierType = 'APP_ATTEST_KEY' | 'INSTALLATION_ID';

const DEVICE_BLOCK_CACHE_TTL_SECONDS = 60;

export function hashDeviceIdentifier(type: DeviceIdentifierType, value: string) {
  return crypto.createHmac('sha256', config.JWT_SECRET).update(`${type}:${value}`).digest('hex');
}

export async function assertRequestDeviceAllowed(req: Request, options?: { required?: boolean }) {
  const installationId = normalizeInstallationId(req.get('x-meetvap-installation-id'));

  if (!installationId && options?.required) {
    throw new HttpError(400, 'A valid app installation identifier is required', { code: 'INSTALLATION_ID_REQUIRED' });
  }

  if (installationId) {
    await assertDeviceIdentifierAllowed('INSTALLATION_ID', installationId);
  }

  return installationId;
}

export async function assertDeviceIdentifierAllowed(type: DeviceIdentifierType, value: string) {
  const identifierHash = hashDeviceIdentifier(type, value);
  const cacheKey = `device-blocked:${type}:${identifierHash}`;
  const cached = await cacheGetJson<{ blocked: boolean }>(cacheKey);

  if (cached?.blocked) {
    throw new HttpError(403, 'This device is blocked', { code: 'DEVICE_BLOCKED' });
  }

  if (cached) {
    return;
  }

  const blocked = await prisma.adminDeviceBlock.findFirst({
    select: { id: true },
    where: { identifierHash, identifierType: type, revokedAt: null },
  });

  await cacheSetJson(cacheKey, { blocked: !!blocked }, DEVICE_BLOCK_CACHE_TTL_SECONDS);

  if (blocked) {
    throw new HttpError(403, 'This device is blocked', { code: 'DEVICE_BLOCKED' });
  }
}

export async function cacheDeviceBlockState(type: DeviceIdentifierType, identifierHash: string, blocked: boolean) {
  await cacheSetJson(`device-blocked:${type}:${identifierHash}`, { blocked }, DEVICE_BLOCK_CACHE_TTL_SECONDS);
}

export async function invalidateDeviceBlockState(type: DeviceIdentifierType, identifierHash: string) {
  await cacheDelete(`device-blocked:${type}:${identifierHash}`);
}
