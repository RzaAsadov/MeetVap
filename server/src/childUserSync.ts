import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import type { ChildUserSnapshot, ChildUserSyncReason } from './childUserSyncSchemas';
import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';
import { getPushRetryDelayMs } from './pushDeliveryPolicy';
import { withRedisLock } from './redisCache';

const SYNC_STATE_ID = 'child-users';
const SYNC_BATCH_SIZE = 100;
const RECONCILE_BATCH_SIZE = 200;
const RECONCILE_MAX_BATCHES_PER_RUN = 5;
const WORKER_INTERVAL_MS = 5_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
let workerRunning = false;
let reconcileRunning = false;

export async function enqueueChildUserSync(userId: string, reason: ChildUserSyncReason = 'UPDATE') {
  if (operationalConfig.serverRole !== 'child') return;
  const snapshot = await createChildUserSnapshot(userId);
  if (!snapshot) return;
  await prisma.childUserSyncEvent.create({
    data: {
      childUserId: userId,
      id: crypto.randomUUID(),
      payload: snapshot as Prisma.InputJsonValue,
      reason,
    },
  });
}

export async function deleteUserWithChildSync(userId: string) {
  await prisma.$transaction(async (tx) => {
    if (operationalConfig.serverRole === 'child') {
      await tx.childUserSyncEvent.create({
        data: {
          childUserId: userId,
          id: crypto.randomUUID(),
          operation: 'DELETE',
          payload: { childUserId: userId },
          reason: 'DELETED',
        },
      });
    }

    await tx.user.delete({ where: { id: userId } });
  });
}

export function startChildUserSyncWorker() {
  if (operationalConfig.serverRole !== 'child') return;

  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await withRedisLock('lock:child-user-sync-submit', 30, submitPendingEvents);
    } finally {
      workerRunning = false;
    }
  };
  const reconcile = async () => {
    if (reconcileRunning) return;
    reconcileRunning = true;
    try {
      await withRedisLock('lock:child-user-sync-reconcile', 240, reconcileChildUsers);
    } finally {
      reconcileRunning = false;
    }
  };

  void reconcile().catch((error) => console.error('Initial child user reconciliation failed', error));
  void run().catch((error) => console.error('Initial child user synchronization failed', error));
  const workerTimer = setInterval(() => {
    void run().catch((error) => console.error('Child user synchronization failed', error));
  }, WORKER_INTERVAL_MS);
  workerTimer.unref();
  const reconcileTimer = setInterval(() => {
    void reconcile().catch((error) => console.error('Child user reconciliation failed', error));
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
}

async function submitPendingEvents() {
  const events = await prisma.childUserSyncEvent.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: SYNC_BATCH_SIZE,
    where: {
      nextAttemptAt: { lte: new Date() },
      status: { in: ['QUEUED', 'RETRYING'] },
    },
  });
  if (events.length === 0) return;

  const response = await fetch(`${getMainServerBaseUrl()}/internal/child-users/batch`, {
    body: JSON.stringify({
      events: events.map((event) => ({
        eventId: event.id,
        operation: event.operation,
        reason: event.reason,
        snapshot: event.payload,
      })),
    }),
    headers: getMainServerHeaders(),
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  }).catch(async (error) => {
    await deferEvents(events.map((event) => event.id), events[0]?.attemptCount ?? 0, error);
    throw error;
  });

  if (!response.ok) {
    const message = `Main child-user sync returned ${response.status}: ${await response.text()}`;
    await deferEvents(events.map((event) => event.id), events[0]?.attemptCount ?? 0, new Error(message));
    throw new Error(message);
  }

  const result = await response.json() as {
    acknowledgedEventIds?: unknown;
    rejected?: unknown;
  };
  if (!Array.isArray(result.acknowledgedEventIds) || !Array.isArray(result.rejected)) {
    const error = new Error('Main child-user sync returned an invalid acknowledgement');
    await deferEvents(events.map((event) => event.id), events[0]?.attemptCount ?? 0, error);
    throw error;
  }

  const acknowledgedIds = result.acknowledgedEventIds.filter((id): id is string => typeof id === 'string');
  const rejected = result.rejected as Array<{ error?: unknown; eventId?: unknown; retryable?: unknown }>;
  await prisma.$transaction(async (tx) => {
    if (acknowledgedIds.length > 0) {
      await tx.childUserSyncEvent.deleteMany({ where: { id: { in: acknowledgedIds } } });
    }
    for (const item of rejected) {
      if (typeof item.eventId !== 'string') continue;
      await tx.childUserSyncEvent.updateMany({
        data: {
          error: typeof item.error === 'string' ? item.error.slice(0, 2000) : 'Rejected by main server',
          status: item.retryable === true ? 'RETRYING' : 'FAILED',
          ...(item.retryable === true ? { nextAttemptAt: new Date(Date.now() + 60_000) } : {}),
        },
        where: { id: item.eventId },
      });
    }
  });
}

async function deferEvents(eventIds: string[], attemptCount: number, error: unknown) {
  const nextAttemptCount = attemptCount + 1;
  await prisma.childUserSyncEvent.updateMany({
    data: {
      attemptCount: { increment: 1 },
      error: getErrorMessage(error),
      nextAttemptAt: new Date(Date.now() + getPushRetryDelayMs(nextAttemptCount, 300)),
      status: 'RETRYING',
    },
    where: { id: { in: eventIds } },
  });
}

async function reconcileChildUsers() {
  for (let batch = 0; batch < RECONCILE_MAX_BATCHES_PER_RUN; batch += 1) {
    const state = await prisma.childUserSyncState.upsert({
      create: { id: SYNC_STATE_ID },
      update: {},
      where: { id: SYNC_STATE_ID },
    });
    const users = await prisma.user.findMany({
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, updatedAt: true },
      take: RECONCILE_BATCH_SIZE,
      where: state.cursorUpdatedAt ? {
        OR: [
          { updatedAt: { gt: state.cursorUpdatedAt } },
          { id: { gt: state.cursorUserId ?? '' }, updatedAt: state.cursorUpdatedAt },
        ],
      } : {},
    });

    if (users.length === 0) {
      await prisma.childUserSyncState.update({
        data: { lastCompletedAt: new Date() },
        where: { id: SYNC_STATE_ID },
      });
      return;
    }

    for (const user of users) await enqueueChildUserSync(user.id, 'RECONCILE');
    const last = users.at(-1)!;
    await prisma.childUserSyncState.update({
      data: { cursorUpdatedAt: last.updatedAt, cursorUserId: last.id },
      where: { id: SYNC_STATE_ID },
    });

    if (users.length < RECONCILE_BATCH_SIZE) {
      await prisma.childUserSyncState.update({
        data: { lastCompletedAt: new Date() },
        where: { id: SYNC_STATE_ID },
      });
      return;
    }
  }
}

async function createChildUserSnapshot(userId: string): Promise<ChildUserSnapshot | null> {
  const user = await prisma.user.findUnique({
    include: {
      pushTokens: { orderBy: { updatedAt: 'desc' }, take: 1 },
      sessions: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    where: { id: userId },
  });
  if (!user) return null;
  const session = user.sessions[0];
  const pushToken = user.pushTokens[0];

  return {
    appBuildNumber: pushToken?.appBuildNumber ?? session?.appBuildNumber ?? null,
    appVersion: pushToken?.appVersion ?? session?.appVersion ?? null,
    avatarUrl: user.avatarUrl,
    childCreatedAt: user.createdAt.toISOString(),
    childUpdatedAt: user.updatedAt.toISOString(),
    childUserId: user.id,
    deviceModel: pushToken?.deviceModel ?? session?.deviceModel ?? null,
    displayName: user.displayName,
    installationId: pushToken?.installationId ?? session?.installationId ?? null,
    lastLoginAt: session?.createdAt.toISOString() ?? null,
    lastSeenAt: user.lastSeenAt.toISOString(),
    latestLocale: pushToken?.locale ?? session?.locale ?? user.registrationLocale,
    latestPlatform: pushToken?.platform ?? session?.platform ?? user.registrationPlatform,
    osVersion: pushToken?.osVersion ?? session?.osVersion ?? null,
    registrationIpAddress: user.registrationIpAddress,
    registrationLocale: user.registrationLocale,
    registrationPlatform: user.registrationPlatform,
    registrationUserAgent: user.registrationUserAgent,
    username: user.username,
  };
}

function getMainServerBaseUrl() {
  return operationalConfig.mainServerHost!.replace(/\/+$/, '');
}

function getMainServerHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-meetvap-main-server-key': operationalConfig.mainServerKey!,
  };
}

function getErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}
