import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { createPushReceiptUrl, MESSAGE_PUSH_OUTBOX_SCOPE } from './childPushRelay';
import { config } from './config';
import { recordProviderReceipts } from './expoPushReceipts';
import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';
import { getPushRetryDelayMs } from './pushDeliveryPolicy';
import { sendMessagePush, type StoredPushToken } from './pushNotifications';
import { invalidatePushTokenCacheForUser } from './pushTokenCache';

const OUTBOX_BATCH_SIZE = 50;
const OUTBOX_POLL_INTERVAL_MS = 2_000;
const PROCESSING_LEASE_MS = 60_000;

const payloadSchema = z.object({
  avatarUrl: z.string().nullable().optional(),
  body: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  pendingTokenIds: z.array(z.string()).optional(),
  senderId: z.string(),
  title: z.string(),
});

export type MessagePushOutboxInput = Omit<z.infer<typeof payloadSchema>, 'pendingTokenIds'>;

let workerRunning = false;

export async function enqueueMessagePush(
  tx: Prisma.TransactionClient,
  input: MessagePushOutboxInput,
) {
  const now = new Date();
  return tx.pushRelayJob.create({
    data: {
      expiresAt: new Date(now.getTime() + operationalConfig.pushNotifications.messageTtlHours * 60 * 60 * 1000),
      nextAttemptAt: now,
      payload: input as Prisma.InputJsonValue,
      requestId: input.messageId,
      scope: MESSAGE_PUSH_OUTBOX_SCOPE,
      type: 'message',
    },
  });
}

export function startMessagePushOutboxWorker() {
  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingMessagePushes();
    } finally {
      workerRunning = false;
    }
  };

  void run().catch((error) => console.error('Initial message push outbox processing failed', error));
  const timer = setInterval(() => {
    void run().catch((error) => console.error('Message push outbox processing failed', error));
  }, OUTBOX_POLL_INTERVAL_MS);
  timer.unref();
}

export function kickMessagePushOutbox(jobId: string) {
  void processMessagePushJob(jobId).catch((error) => {
    console.error('Immediate message push outbox processing failed', { error, jobId });
  });
}

async function processPendingMessagePushes() {
  const now = new Date();
  await prisma.pushRelayJob.updateMany({
    data: { status: 'RETRYING' },
    where: {
      scope: MESSAGE_PUSH_OUTBOX_SCOPE,
      status: 'PROCESSING',
      updatedAt: { lt: new Date(now.getTime() - PROCESSING_LEASE_MS) },
    },
  });

  const jobs = await prisma.pushRelayJob.findMany({
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
    take: OUTBOX_BATCH_SIZE,
    where: {
      nextAttemptAt: { lte: now },
      scope: MESSAGE_PUSH_OUTBOX_SCOPE,
      status: { in: ['QUEUED', 'RETRYING'] },
    },
  });

  await Promise.all(jobs.map((job) => processMessagePushJob(job.id)));
}

async function processMessagePushJob(jobId: string) {
  const now = new Date();
  const claimed = await prisma.pushRelayJob.updateMany({
    data: {
      attemptCount: { increment: 1 },
      error: null,
      status: 'PROCESSING',
    },
    where: {
      id: jobId,
      nextAttemptAt: { lte: now },
      scope: MESSAGE_PUSH_OUTBOX_SCOPE,
      status: { in: ['QUEUED', 'RETRYING'] },
    },
  });
  if (claimed.count === 0) return;

  const job = await prisma.pushRelayJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.expiresAt && job.expiresAt <= now) {
    await completeJob(jobId, 'EXPIRED', { error: 'Message notification TTL expired' });
    return;
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(job.payload);
  } catch (error) {
    await completeJob(jobId, 'FAILED', { error: getErrorMessage(error) });
    return;
  }

  try {
    const tokens = await loadRecipientTokens(payload);
    if (tokens.length === 0) {
      await completeJob(jobId, 'NO_RECIPIENTS');
      return;
    }

    const tokensWithReceipts = addReceiptUrls(job.requestId, tokens);
    const result = await sendMessagePush({
      avatarUrl: payload.avatarUrl,
      body: payload.body,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      title: payload.title,
      tokens: tokensWithReceipts,
    });

    await recordProviderReceipts(jobId, result.providerReceipts);
    await deleteInvalidTokens(result.invalidTokenIds, tokens);

    if (operationalConfig.serverRole === 'child') {
      await completeJob(jobId, 'PROVIDER_ACCEPTED', { acceptedCount: tokens.length });
      return;
    }

    const retryableTokenIds = [...new Set(result.retryableTokenIds)];
    if (result.skippedCount > 0 && retryableTokenIds.length === 0) {
      retryableTokenIds.push(...tokens.flatMap((token) => token.id ? [token.id] : []));
    }

    if (retryableTokenIds.length > 0 && shouldRetry(job.attemptCount, job.expiresAt)) {
      await scheduleRetry(jobId, job.attemptCount, payload, retryableTokenIds, result);
      return;
    }

    await completeJob(jobId, result.acceptedCount > 0 ? 'PROVIDER_ACCEPTED' : 'FAILED', {
      acceptedCount: result.acceptedCount,
      failedCount: result.failedCount,
      invalidTokenIds: result.invalidTokenIds,
      skippedCount: result.skippedCount,
    });
  } catch (error) {
    if (shouldRetry(job.attemptCount, job.expiresAt)) {
      await scheduleRetry(jobId, job.attemptCount, payload, payload.pendingTokenIds, undefined, error);
      return;
    }
    await completeJob(jobId, 'FAILED', { error: getErrorMessage(error) });
  }
}

async function loadRecipientTokens(payload: z.infer<typeof payloadSchema>): Promise<StoredPushToken[]> {
  return prisma.devicePushToken.findMany({
    select: {
      id: true,
      installationId: true,
      locale: true,
      platform: true,
      provider: true,
      token: true,
      userId: true,
    },
    where: {
      ...(payload.pendingTokenIds ? { id: { in: payload.pendingTokenIds } } : {}),
      user: {
        memberships: {
          some: {
            conversationId: payload.conversationId,
            AND: [
              { OR: [{ mutedAt: null }, { mutedUntil: { lte: new Date() } }] },
              { OR: [{ aliasPromptSeen: true }, { conversation: { type: { not: 'GROUP' } } }] },
            ],
          },
        },
      },
      userId: { not: payload.senderId },
    },
  });
}

function addReceiptUrls(requestId: string, tokens: StoredPushToken[]) {
  if (!config.PUBLIC_API_URL) return tokens;
  return tokens.map((token) => token.id
    ? { ...token, deliveryReceiptUrl: createPushReceiptUrl(requestId, token.id) }
    : token);
}

async function deleteInvalidTokens(invalidTokenIds: string[], tokens: StoredPushToken[]) {
  if (invalidTokenIds.length === 0) return;
  const invalidIds = [...new Set(invalidTokenIds)];
  const userIds = [...new Set(tokens
    .filter((token) => token.id && invalidIds.includes(token.id))
    .flatMap((token) => token.userId ? [token.userId] : []))];

  await prisma.devicePushToken.deleteMany({ where: { id: { in: invalidIds } } });
  await Promise.all(userIds.map(invalidatePushTokenCacheForUser));
}

function shouldRetry(attemptCount: number, expiresAt: Date | null) {
  return attemptCount < operationalConfig.pushNotifications.outboxMaxAttempts &&
    (!expiresAt || expiresAt.getTime() > Date.now());
}

async function scheduleRetry(
  jobId: string,
  attemptCount: number,
  payload: z.infer<typeof payloadSchema>,
  pendingTokenIds?: string[],
  result?: { acceptedCount: number; failedCount: number; invalidTokenIds: string[]; skippedCount: number },
  error?: unknown,
) {
  const delayMs = getPushRetryDelayMs(
    attemptCount,
    operationalConfig.pushNotifications.outboxMaxRetrySeconds,
  );
  await prisma.pushRelayJob.updateMany({
    data: {
      acceptedCount: { increment: result?.acceptedCount ?? 0 },
      error: error ? getErrorMessage(error) : null,
      failedCount: result?.failedCount ?? 0,
      invalidTokenIds: result?.invalidTokenIds ?? [],
      nextAttemptAt: new Date(Date.now() + delayMs),
      payload: { ...payload, ...(pendingTokenIds ? { pendingTokenIds } : {}) } as Prisma.InputJsonValue,
      skippedCount: result?.skippedCount ?? 0,
      status: 'RETRYING',
    },
    where: { id: jobId, status: 'PROCESSING' },
  });
}

async function completeJob(jobId: string, status: string, result: {
  acceptedCount?: number;
  error?: string;
  failedCount?: number;
  invalidTokenIds?: string[];
  skippedCount?: number;
} = {}) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ receivedCount: number }>>`
      select "receivedCount" from "PushRelayJob" where id = ${jobId} for update
    `;
    if (!rows[0]) return;
    await tx.pushRelayJob.updateMany({
      data: {
        acceptedCount: { increment: result.acceptedCount ?? 0 },
        completedAt: new Date(),
        error: result.error ?? null,
        failedCount: result.failedCount ?? 0,
        invalidTokenIds: result.invalidTokenIds ?? [],
        payload: Prisma.JsonNull,
        skippedCount: result.skippedCount ?? 0,
        status: rows[0].receivedCount > 0 ? 'DEVICE_RECEIVED' : status,
      },
      where: { id: jobId, status: 'PROCESSING' },
    });
  });
}

function getErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}
