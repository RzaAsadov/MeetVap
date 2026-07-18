import { Request } from 'express';

import { getRequestClientMetadata } from './clientCompatibility';
import { prisma } from './prisma';
import { JwtPayload } from './types';

export type MessageClientKind = 'MOBILE' | 'WEB';
export type MessageClientIdentity = string;

const CLIENT_ACTIVITY_WRITE_TTL_MS = 10 * 60 * 1000;
const INSTALLATION_ID_HEADER = 'x-meetvap-installation-id';
const recentClientActivityWrites = new Map<string, number>();

export function getRequestMessageClient(req: Request, payload?: JwtPayload): MessageClientIdentity {
  if (payload?.scope === 'web') {
    return buildMessageClientIdentity('WEB', req.get(INSTALLATION_ID_HEADER));
  }

  const platform = getRequestClientMetadata(req).platform?.trim().toLowerCase();

  return buildMessageClientIdentity(platform === 'web' ? 'WEB' : 'MOBILE', req.get(INSTALLATION_ID_HEADER));
}

export function normalizeMessageClient(value: unknown, fallback: MessageClientKind = 'MOBILE'): MessageClientKind {
  return typeof value === 'string' && value.trim().toUpperCase() === 'WEB' ? 'WEB' : fallback;
}

export function buildMessageClientIdentity(kind: MessageClientKind, installationId: unknown): MessageClientIdentity {
  const normalizedInstallationId = normalizeInstallationId(installationId);

  // TODO-MEETVAP-REMOVE-LEGACY-MOBILE-ACK: remove plain MOBILE after all
  // active mobile builds send a stable installation identifier.
  return normalizedInstallationId ? `${kind}:${normalizedInstallationId}` : kind;
}

export function getMessageClientKind(client: MessageClientIdentity): MessageClientKind {
  return client === 'WEB' || client.startsWith('WEB:') ? 'WEB' : 'MOBILE';
}

export function getSocketMessageClientIdentity(isWeb: boolean, installationId: unknown): MessageClientIdentity {
  return buildMessageClientIdentity(isWeb ? 'WEB' : 'MOBILE', installationId);
}

export async function recordUserClientActivity(userId: string, client: MessageClientIdentity) {
  const key = `${userId}:${client}`;
  const now = Date.now();
  const lastWriteAt = recentClientActivityWrites.get(key) ?? 0;

  if (now - lastWriteAt < CLIENT_ACTIVITY_WRITE_TTL_MS) {
    return;
  }

  recentClientActivityWrites.set(key, now);

  await prisma.userClientActivity.upsert({
    create: {
      client,
      lastSeenAt: new Date(now),
      userId,
    },
    update: {
      lastSeenAt: new Date(now),
    },
    where: {
      userId_client: {
        client,
        userId,
      },
    },
  }).catch(() => {
    recentClientActivityWrites.delete(key);
  });
}

function normalizeInstallationId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';

  return /^[A-Za-z0-9._-]{16,64}$/.test(normalized) ? normalized : null;
}
