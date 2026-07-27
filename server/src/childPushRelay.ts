import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { config } from './config';
import { HttpError } from './httpError';
import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';
import { invalidatePushTokenCacheForUser } from './pushTokenCache';

const CHILD_SCOPE = 'child';
const STATUS_BATCH_LIMIT = 500;
const PUSH_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
let workerRunning = false;
export const childPushReceiptRoutes = Router();

type MainStatusItem = {
  acceptedCount: number;
  completedAt: string | null;
  error: string | null;
  failedCount: number;
  invalidTokenIds: string[];
  relayId: string;
  requestId: string;
  skippedCount: number;
  status: string;
  type: string;
  updatedAt: string;
};

export async function relayPushToMainServer(type: string, input: unknown) {
  if (operationalConfig.serverRole !== 'child') {
    return false;
  }

  const requestId = crypto.randomUUID();
  const relayInput = addDeliveryReceiptUrls(requestId, input);
  const job = await prisma.pushRelayJob.create({
    data: {
      payload: { input: relayInput, type } as Prisma.InputJsonValue,
      requestId,
      scope: CHILD_SCOPE,
      type,
    },
  });

  await submitChildPushJob(job.id);
  return true;
}

childPushReceiptRoutes.post('/:requestId/:tokenId', async (req, res, next) => {
  try {
    if (operationalConfig.serverRole !== 'child') {
      throw new HttpError(404, 'Route not found');
    }

    const expiresAt = Number(getSingleQueryValue(req.query.expiresAt));
    const signature = getSingleQueryValue(req.query.signature);
    if (!isValidPushReceipt(req.params.requestId, req.params.tokenId, expiresAt, signature)) {
      throw new HttpError(401, 'Invalid push receipt');
    }

    await prisma.$transaction(async (tx) => {
      const job = await tx.pushRelayJob.findUnique({
        select: { id: true, receivedTokenIds: true },
        where: {
          scope_requestId: {
            requestId: req.params.requestId,
            scope: CHILD_SCOPE,
          },
        },
      });
      if (!job || job.receivedTokenIds.includes(req.params.tokenId)) {
        return;
      }

      const receivedTokenIds = [...job.receivedTokenIds, req.params.tokenId];
      await tx.pushRelayJob.update({
        data: {
          receivedCount: receivedTokenIds.length,
          receivedTokenIds,
          status: 'DEVICE_RECEIVED',
        },
        where: { id: job.id },
      });
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export function startChildPushRelayWorker() {
  if (operationalConfig.serverRole !== 'child') {
    return;
  }
  if (!config.PUBLIC_API_URL) {
    console.warn('Child push device receipts are disabled because PUBLIC_API_URL is not configured');
  }

  const run = async () => {
    if (workerRunning) {
      return;
    }

    workerRunning = true;
    try {
      await submitPendingChildPushJobs();
      await synchronizeChildPushStatuses();
    } finally {
      workerRunning = false;
    }
  };

  void run().catch((error) => console.error('Initial child push relay synchronization failed', error));
  const timer = setInterval(() => {
    void run().catch((error) => console.error('Child push relay synchronization failed', error));
  }, 2_000);
  timer.unref();
}

async function submitPendingChildPushJobs() {
  const jobs = await prisma.pushRelayJob.findMany({
    select: { id: true },
    take: 100,
    where: {
      remoteRelayId: null,
      scope: CHILD_SCOPE,
      status: { in: ['QUEUED', 'DEVICE_RECEIVED'] },
    },
  });

  await Promise.all(jobs.map((job) => submitChildPushJob(job.id).catch((error) => {
    console.warn('Child push relay submission failed', {
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    });
  })));
}

async function submitChildPushJob(jobId: string) {
  const currentJob = await prisma.pushRelayJob.findUnique({ where: { id: jobId } });
  const preserveDeviceReceipt = currentJob?.status === 'DEVICE_RECEIVED';
  if (!currentJob || currentJob.remoteRelayId || (!preserveDeviceReceipt && currentJob.status !== 'QUEUED')) {
    return;
  }
  if (!preserveDeviceReceipt) {
    const claimed = await prisma.pushRelayJob.updateMany({
      data: {
        error: null,
        status: 'SUBMITTING',
      },
      where: {
        id: jobId,
        remoteRelayId: null,
        status: 'QUEUED',
      },
    });
    if (claimed.count === 0) {
      return;
    }
  }

  const job = await prisma.pushRelayJob.findUniqueOrThrow({ where: { id: jobId } });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const payload = job.payload as { input?: unknown; type?: unknown } | null;
    const response = await fetch(`${getMainServerBaseUrl()}/internal/child-push`, {
      body: JSON.stringify({
        input: payload?.input,
        requestId: job.requestId,
        type: payload?.type ?? job.type,
      }),
      headers: getMainServerHeaders(),
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Main push relay returned ${response.status}: ${await response.text()}`);
    }

    const result = await response.json() as { relayId?: unknown; status?: unknown };
    if (typeof result.relayId !== 'string' || typeof result.status !== 'string') {
      throw new Error('Main push relay returned an invalid response');
    }

    await prisma.$transaction([
      prisma.pushRelayJob.update({
        data: { remoteRelayId: result.relayId },
        where: { id: jobId },
      }),
      prisma.pushRelayJob.updateMany({
        data: { status: result.status },
        where: {
          id: jobId,
          status: { not: 'DEVICE_RECEIVED' },
        },
      }),
    ]);
  } catch (error) {
    await prisma.pushRelayJob.updateMany({
      data: {
        error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
        status: 'QUEUED',
      },
      where: {
        id: jobId,
        status: { not: 'DEVICE_RECEIVED' },
      },
    }).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function synchronizeChildPushStatuses() {
  const stateId = getSyncStateId();
  let state = await prisma.pushRelaySyncState.findUnique({ where: { id: stateId } });
  let hasMore = true;

  while (hasMore) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(`${getMainServerBaseUrl()}/internal/child-push/statuses`, {
        body: JSON.stringify({
          cursor: state?.cursor ?? null,
          limit: STATUS_BATCH_LIMIT,
        }),
        headers: getMainServerHeaders(),
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Main push status sync returned ${response.status}: ${await response.text()}`);
      }

      const batch = await response.json() as {
        hasMore?: unknown;
        items?: unknown;
        nextCursor?: unknown;
      };
      if (
        typeof batch.hasMore !== 'boolean' ||
        !Array.isArray(batch.items) ||
        (batch.nextCursor !== null && typeof batch.nextCursor !== 'string')
      ) {
        throw new Error('Main push status sync returned an invalid response');
      }

      const items = batch.items as MainStatusItem[];
      const invalidTokenIds = [...new Set(items.flatMap((item) => (
        Array.isArray(item.invalidTokenIds) ? item.invalidTokenIds.filter((id) => typeof id === 'string') : []
      )))];
      const invalidTokens = invalidTokenIds.length > 0
        ? await prisma.devicePushToken.findMany({
            select: { userId: true },
            where: { id: { in: invalidTokenIds } },
          })
        : [];

      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          if (
            typeof item.requestId !== 'string' ||
            typeof item.relayId !== 'string' ||
            typeof item.status !== 'string'
          ) {
            continue;
          }

          await tx.pushRelayJob.updateMany({
            data: {
              acceptedCount: Number(item.acceptedCount) || 0,
              completedAt: item.completedAt ? new Date(item.completedAt) : null,
              error: typeof item.error === 'string' ? item.error.slice(0, 2000) : null,
              failedCount: Number(item.failedCount) || 0,
              invalidTokenIds: Array.isArray(item.invalidTokenIds) ? item.invalidTokenIds : [],
              payload: isTerminalRelayStatus(item.status) ? Prisma.JsonNull : undefined,
              remoteRelayId: item.relayId,
              skippedCount: Number(item.skippedCount) || 0,
            },
            where: {
              requestId: item.requestId,
              scope: CHILD_SCOPE,
            },
          });
          await tx.pushRelayJob.updateMany({
            data: { status: item.status },
            where: {
              requestId: item.requestId,
              scope: CHILD_SCOPE,
              status: { not: 'DEVICE_RECEIVED' },
            },
          });
        }

        if (invalidTokenIds.length > 0) {
          await tx.devicePushToken.deleteMany({ where: { id: { in: invalidTokenIds } } });
        }

        state = await tx.pushRelaySyncState.upsert({
          create: {
            cursor: batch.nextCursor as string | null,
            id: stateId,
          },
          update: { cursor: batch.nextCursor as string | null },
          where: { id: stateId },
        });
      });

      await Promise.all([...new Set(invalidTokens.map((item) => item.userId))].map(invalidatePushTokenCacheForUser));
      hasMore = batch.hasMore;
    } finally {
      clearTimeout(timeout);
    }
  }
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

function getSyncStateId() {
  return `main-push:${crypto.createHash('sha256').update(getMainServerBaseUrl()).digest('hex').slice(0, 24)}`;
}

function addDeliveryReceiptUrls(requestId: string, input: unknown) {
  if (!config.PUBLIC_API_URL || !input || typeof input !== 'object') {
    return input;
  }

  const value = input as { tokens?: unknown };
  if (!Array.isArray(value.tokens)) {
    return input;
  }

  return {
    ...value,
    tokens: value.tokens.map((token) => {
      if (!token || typeof token !== 'object' || !('id' in token) || typeof token.id !== 'string') {
        return token;
      }

      return {
        ...token,
        deliveryReceiptUrl: createPushReceiptUrl(requestId, token.id),
      };
    }),
  };
}

function createPushReceiptUrl(requestId: string, tokenId: string) {
  const expiresAt = Date.now() + PUSH_RECEIPT_TTL_MS;
  const url = new URL(`/push-receipts/${encodeURIComponent(requestId)}/${encodeURIComponent(tokenId)}`, config.PUBLIC_API_URL);
  url.searchParams.set('expiresAt', String(expiresAt));
  url.searchParams.set('signature', createPushReceiptSignature(requestId, tokenId, expiresAt));
  return url.toString();
}

function createPushReceiptSignature(requestId: string, tokenId: string, expiresAt: number) {
  return crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(`push-received:${requestId}:${tokenId}:${expiresAt}`)
    .digest('hex');
}

function isValidPushReceipt(requestId: string, tokenId: string, expiresAt: number, signature?: string) {
  if (
    !signature ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < Date.now() ||
    expiresAt > Date.now() + PUSH_RECEIPT_TTL_MS
  ) {
    return false;
  }

  const expected = Buffer.from(createPushReceiptSignature(requestId, tokenId, expiresAt), 'hex');
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function getSingleQueryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function isTerminalRelayStatus(status: string) {
  return status === 'PROVIDER_ACCEPTED' ||
    status === 'PARTIAL' ||
    status === 'FAILED' ||
    status === 'DEVICE_RECEIVED' ||
    status === 'EXPIRED';
}
