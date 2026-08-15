import { MESSAGE_PUSH_OUTBOX_SCOPE } from './childPushRelay';
import { prisma } from './prisma';
import { invalidatePushTokenCacheForUser } from './pushTokenCache';
import type { PushDispatchResult } from './pushNotifications';

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const RECEIPT_BATCH_SIZE = 500;
const RECEIPT_INITIAL_DELAY_MS = 15_000;
const RECEIPT_POLL_INTERVAL_MS = 15_000;
const RECEIPT_MAX_ATTEMPTS = 12;
let workerRunning = false;

export async function recordProviderReceipts(jobId: string, receipts: PushDispatchResult['providerReceipts']) {
  if (receipts.length === 0) return;
  await prisma.pushProviderReceipt.createMany({
    data: receipts.map((receipt) => ({
      nextAttemptAt: new Date(Date.now() + RECEIPT_INITIAL_DELAY_MS),
      provider: receipt.provider,
      pushJobId: jobId,
      receiptId: receipt.receiptId,
      tokenId: receipt.tokenId,
    })),
    skipDuplicates: true,
  });
}

export function startExpoPushReceiptWorker() {
  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await pollExpoReceipts();
    } finally {
      workerRunning = false;
    }
  };

  const timer = setInterval(() => {
    void run().catch((error) => console.error('Expo push receipt polling failed', error));
  }, RECEIPT_POLL_INTERVAL_MS);
  timer.unref();
}

async function pollExpoReceipts() {
  const receipts = await prisma.pushProviderReceipt.findMany({
    include: { pushJob: { select: { acceptedCount: true, domainId: true, id: true, scope: true, status: true } } },
    orderBy: { nextAttemptAt: 'asc' },
    take: RECEIPT_BATCH_SIZE,
    where: {
      nextAttemptAt: { lte: new Date() },
      provider: 'expo',
      status: 'PENDING',
    },
  });
  if (receipts.length === 0) return;

  const response = await fetch(EXPO_RECEIPTS_URL, {
    body: JSON.stringify({ ids: receipts.map((receipt) => receipt.receiptId) }),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Expo receipt request returned ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as {
    data?: Record<string, { details?: { error?: string }; message?: string; status?: string }>;
  };
  const results = payload.data ?? {};
  await Promise.all(receipts.map(async (receipt) => {
    const result = results[receipt.receiptId];
    if (!result) {
      await deferReceipt(receipt.id, receipt.attemptCount, 'Receipt is not ready');
      return;
    }
    if (result.status === 'ok') {
      await prisma.pushProviderReceipt.update({
        data: { attemptCount: { increment: 1 }, completedAt: new Date(), error: null, status: 'DELIVERED' },
        where: { id: receipt.id },
      });
      return;
    }

    const reason = result.details?.error ?? result.message ?? 'Expo rejected the notification';
    const isInvalidToken = result.details?.error === 'DeviceNotRegistered';
    await prisma.$transaction(async (tx) => {
      await tx.pushProviderReceipt.update({
        data: { attemptCount: { increment: 1 }, completedAt: new Date(), error: reason.slice(0, 2000), status: 'FAILED' },
        where: { id: receipt.id },
      });
      await tx.pushRelayJob.update({
        data: {
          failedCount: { increment: 1 },
          ...(isInvalidToken && receipt.tokenId
            ? { invalidTokenIds: { push: receipt.tokenId } }
            : {}),
          ...(['QUEUED', 'RETRYING', 'PROCESSING', 'SUBMITTING'].includes(receipt.pushJob.status)
            ? {}
            : { status: receipt.pushJob.acceptedCount > 1 ? 'PARTIAL' : 'FAILED' }),
        },
        where: { id: receipt.pushJob.id },
      });
      if (receipt.pushJob.domainId) {
        await tx.pushRelayStatusEvent.create({
          data: { domainId: receipt.pushJob.domainId, jobId: receipt.pushJob.id },
        });
      }
    });

    if (isInvalidToken && receipt.tokenId && receipt.pushJob.scope === MESSAGE_PUSH_OUTBOX_SCOPE) {
      const token = await prisma.devicePushToken.findUnique({
        select: { userId: true },
        where: { id: receipt.tokenId },
      });
      await prisma.devicePushToken.deleteMany({ where: { id: receipt.tokenId } });
      if (token) await invalidatePushTokenCacheForUser(token.userId);
    }
  }));
}

async function deferReceipt(id: string, attemptCount: number, error: string) {
  const nextAttemptCount = attemptCount + 1;
  if (nextAttemptCount >= RECEIPT_MAX_ATTEMPTS) {
    await prisma.pushProviderReceipt.update({
      data: { attemptCount: nextAttemptCount, completedAt: new Date(), error, status: 'EXPIRED' },
      where: { id },
    });
    return;
  }
  const delayMs = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(nextAttemptCount - 1, 5));
  await prisma.pushProviderReceipt.update({
    data: {
      attemptCount: nextAttemptCount,
      error,
      nextAttemptAt: new Date(Date.now() + delayMs),
    },
    where: { id },
  });
}
