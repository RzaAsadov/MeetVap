import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Request, Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../httpError';
import { childUserSnapshotSchema } from '../childUserSyncSchemas';
import { recordProviderReceipts } from '../expoPushReceipts';
import { operationalConfig, refreshOperationalAppVersionsFromDisk } from '../operationalConfig';
import { prisma } from '../prisma';
import { getPushRetryDelayMs } from '../pushDeliveryPolicy';
import { PushDispatchResult, sendCallEndedPush, sendIncomingCallPush, sendMessagePush } from '../pushNotifications';
import { notifyServerChildUserRegistered } from '../serverEventMessages';

export const internalPushRoutes = Router();

const tokenSchema = z.object({
  deliveryReceiptUrl: z.string().url().max(2048).optional(),
  id: z.string().max(128).optional(),
  installationId: z.string().max(256).nullable().optional(),
  locale: z.string().max(16).nullable().optional(),
  platform: z.string().max(32).nullable().optional(),
  provider: z.enum(['expo', 'fcm', 'apns', 'apns_voip']),
  quickReplyToken: z.string().max(4096).optional(),
  token: z.string().min(1).max(8192),
  userId: z.string().max(128).nullable().optional(),
});
const commonSchema = z.object({
  body: z.string().max(8000),
  conversationId: z.string().min(1).max(128),
  title: z.string().max(200),
  tokens: z.array(tokenSchema).max(5000),
});
const relaySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), input: commonSchema.extend({ avatarUrl: z.string().max(2048).nullable().optional(), messageId: z.string().min(1).max(128) }) }),
  z.object({ type: z.literal('incoming-call'), input: commonSchema.extend({
    autoJoin: z.boolean().optional(), avatarUrl: z.string().max(2048).nullable().optional(), callId: z.string().min(1).max(128),
    isGroupCall: z.boolean().optional(), mode: z.enum(['VOICE', 'VIDEO']), participantNames: z.array(z.string().max(120)).max(50).optional(),
    ringingReceiptUrl: z.string().max(2048).optional(),
  }) }),
  z.object({ type: z.literal('call-ended'), input: commonSchema.omit({ body: true }).extend({
    callId: z.string().min(1).max(128), callStatus: z.enum(['CANCELLED', 'DECLINED', 'ENDED', 'MISSED']).optional(),
    isGroupCall: z.boolean().optional(), mode: z.enum(['VOICE', 'VIDEO']),
  }) }),
]);
const submissionSchema = z.object({
  input: z.unknown(),
  requestId: z.string().uuid().optional(),
  type: z.enum(['message', 'incoming-call', 'call-ended']),
});
const statusBatchSchema = z.object({
  cursor: z.string().max(1024).nullable().optional(),
  limit: z.number().int().min(1).max(500).default(500),
});
const childUserBatchEnvelopeSchema = z.object({
  events: z.array(z.unknown()).min(1).max(200),
});
const childUserEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  operation: z.enum(['UPSERT', 'DELETE']),
  reason: z.enum(['REGISTERED', 'LOGIN', 'PROFILE', 'DEVICE', 'RECONCILE', 'UPDATE', 'DELETED']).default('UPDATE'),
  snapshot: z.unknown().nullable(),
});

internalPushRoutes.get('/child-config/app-versions', async (req, res, next) => {
  try {
    await authenticateChildRequest(req);
    const appVersions = await refreshOperationalAppVersionsFromDisk();
    const etag = `"${crypto.createHash('sha256').update(JSON.stringify(appVersions)).digest('base64url')}"`;

    if (req.get('if-none-match') === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    res.json({ appVersions });
  } catch (error) {
    next(error);
  }
});

internalPushRoutes.post('/child-users/batch', async (req, res, next) => {
  try {
    const domain = await authenticateChildRequest(req);
    const input = childUserBatchEnvelopeSchema.parse(req.body);
    const acknowledgedEventIds: string[] = [];
    const rejected: Array<{ error: string; eventId: string | null; retryable: boolean }> = [];

    for (const rawEvent of input.events) {
      const envelopeResult = childUserEventEnvelopeSchema.safeParse(rawEvent);

      if (!envelopeResult.success) {
        rejected.push({
          error: envelopeResult.error.issues[0]?.message ?? 'Invalid child user event',
          eventId: getUntrustedEventId(rawEvent),
          retryable: false,
        });
        continue;
      }

      const event = envelopeResult.data;

      try {
        if (event.operation === 'DELETE') {
          const childUserId = getDeletionChildUserId(event.snapshot);
          await prisma.childServerUser.updateMany({
            data: { deletedAt: new Date(), lastSyncedAt: new Date() },
            where: { childUserId, domainId: domain.id },
          });
        } else {
          const snapshot = childUserSnapshotSchema.parse(event.snapshot);
          await upsertChildServerUser(domain.id, snapshot);
          if (event.reason === 'REGISTERED') {
            await notifyServerChildUserRegistered({
              domain,
              io: req.app.get('io'),
              occurredAt: new Date(snapshot.childCreatedAt),
              platform: snapshot.latestPlatform ?? snapshot.registrationPlatform,
              user: {
                displayName: snapshot.displayName,
                id: snapshot.childUserId,
                username: snapshot.username,
              },
            });
          }
        }
        acknowledgedEventIds.push(event.eventId);
      } catch (error) {
        rejected.push({
          error: error instanceof z.ZodError
            ? error.issues[0]?.message ?? 'Invalid child user snapshot'
            : getRelayError(error),
          eventId: event.eventId,
          retryable: !(error instanceof z.ZodError || error instanceof HttpError),
        });
      }
    }

    res.json({ acknowledgedEventIds, rejected });
  } catch (error) {
    next(error);
  }
});

internalPushRoutes.post('/child-push', async (req, res, next) => {
  try {
    const domain = await authenticateChildRequest(req);
    const submission = submissionSchema.parse(req.body);
    const payload = relaySchema.parse({ input: submission.input, type: submission.type });
    assertDeliveryReceiptOrigins(payload.input.tokens, domain.hostname);
    const requestId = submission.requestId ?? crypto.randomUUID();
    const scope = `main:${domain.id}`;
    const job = await prisma.pushRelayJob.upsert({
      create: {
        domainId: domain.id,
        expiresAt: getRelayExpiry(payload.type),
        payload: payload as Prisma.InputJsonValue,
        requestId,
        scope,
        type: payload.type,
      },
      update: {},
      where: {
        scope_requestId: {
          requestId,
          scope,
        },
      },
    });

    void processMainPushRelayJob(job.id).catch((error) => {
      console.error('Immediate main push relay processing failed', { error, jobId: job.id });
    });
    res.status(202).json({
      relayId: job.id,
      requestId: job.requestId,
      status: job.status,
    });
  } catch (error) {
    next(error);
  }
});

internalPushRoutes.post('/child-push/statuses', async (req, res, next) => {
  try {
    const domain = await authenticateChildRequest(req);
    const input = statusBatchSchema.parse(req.body);
    const cursor = decodeStatusCursor(input.cursor);
    const events = await prisma.pushRelayStatusEvent.findMany({
      include: { job: true },
      orderBy: { id: 'asc' },
      take: input.limit,
      where: {
        domainId: domain.id,
        ...(cursor === null ? {} : { id: { gt: cursor } }),
      },
    });
    const lastEvent = events.at(-1);

    res.json({
      hasMore: events.length === input.limit,
      items: events.map(({ job }) => ({
        acceptedCount: job.acceptedCount,
        completedAt: job.completedAt?.toISOString() ?? null,
        error: job.error,
        failedCount: job.failedCount,
        invalidTokenIds: job.invalidTokenIds,
        relayId: job.id,
        requestId: job.requestId,
        skippedCount: job.skippedCount,
        status: job.status,
        type: job.type,
        updatedAt: job.updatedAt.toISOString(),
      })),
      nextCursor: lastEvent ? lastEvent.id.toString() : input.cursor ?? null,
    });
  } catch (error) {
    next(error);
  }
});

export function startMainPushRelayWorker() {
  if (operationalConfig.serverRole !== 'main') {
    return;
  }

  const recover = async () => {
    const staleBefore = new Date(Date.now() - 60_000);
    await prisma.pushRelayJob.updateMany({
      data: { status: 'QUEUED' },
      where: {
        scope: { startsWith: 'main:' },
        status: 'PROCESSING',
        updatedAt: { lt: staleBefore },
      },
    });
    const jobs = await prisma.pushRelayJob.findMany({
      select: { id: true },
      take: 100,
      where: {
        scope: { startsWith: 'main:' },
        nextAttemptAt: { lte: new Date() },
        status: { in: ['QUEUED', 'RETRYING'] },
      },
    });
    await Promise.all(jobs.map((job) => processMainPushRelayJob(job.id)));
  };

  void recover().catch((error) => console.error('Initial main push relay recovery failed', error));
  const timer = setInterval(() => {
    void recover().catch((error) => console.error('Main push relay recovery failed', error));
  }, 2_000);
  timer.unref();
}

async function processMainPushRelayJob(jobId: string) {
  const claimed = await prisma.pushRelayJob.updateMany({
    data: {
      error: null,
      attemptCount: { increment: 1 },
      status: 'PROCESSING',
    },
    where: {
      id: jobId,
      nextAttemptAt: { lte: new Date() },
      status: { in: ['QUEUED', 'RETRYING'] },
    },
  });

  if (claimed.count === 0) {
    return;
  }

  let domainId: string | null = null;

  try {
    const job = await prisma.pushRelayJob.findUniqueOrThrow({ where: { id: jobId } });
    domainId = job.domainId;
    if (job.expiresAt && job.expiresAt <= new Date()) {
      await completeMainRelayJob(jobId, domainId, 'EXPIRED', {
        error: 'Push relay TTL expired',
      });
      return;
    }
    const payload = relaySchema.parse(job.payload);
    let result: PushDispatchResult;

    if (payload.type === 'message') result = await sendMessagePush(payload.input);
    else if (payload.type === 'incoming-call') result = await sendIncomingCallPush(payload.input);
    else result = await sendCallEndedPush(payload.input);

    await recordProviderReceipts(jobId, result.providerReceipts);

    const retryableTokenIds = [...new Set(result.retryableTokenIds)];
    if (result.skippedCount > 0 && retryableTokenIds.length === 0) {
      retryableTokenIds.push(...payload.input.tokens.flatMap((token) => token.id ? [token.id] : []));
    }
    if (retryableTokenIds.length > 0 && canRetryMainRelay(job.attemptCount, job.expiresAt)) {
      const retryPayload = {
        ...payload,
        input: {
          ...payload.input,
          tokens: payload.input.tokens.filter((token) => token.id && retryableTokenIds.includes(token.id)),
        },
      };
      await prisma.pushRelayJob.update({
        data: {
          acceptedCount: { increment: result.acceptedCount },
          failedCount: result.failedCount,
          invalidTokenIds: [...new Set([...job.invalidTokenIds, ...result.invalidTokenIds])],
          nextAttemptAt: getNextRelayAttemptAt(job.attemptCount),
          payload: retryPayload as Prisma.InputJsonValue,
          skippedCount: result.skippedCount,
          status: 'RETRYING',
        },
        where: { id: jobId },
      });
      return;
    }
    await completeMainRelayJob(jobId, domainId, getCompletedRelayStatus(result), {
      acceptedCount: result.acceptedCount,
      failedCount: result.failedCount,
      invalidTokenIds: [...new Set([...job.invalidTokenIds, ...result.invalidTokenIds])],
      skippedCount: result.skippedCount,
    });
  } catch (error) {
    const job = await prisma.pushRelayJob.findUnique({ where: { id: jobId } }).catch(() => null);
    if (job && canRetryMainRelay(job.attemptCount, job.expiresAt)) {
      await prisma.pushRelayJob.update({
        data: {
          error: getRelayError(error),
          nextAttemptAt: getNextRelayAttemptAt(job.attemptCount),
          status: 'RETRYING',
        },
        where: { id: jobId },
      }).catch(() => undefined);
      return;
    }
    await completeMainRelayJob(jobId, domainId, 'FAILED', { error: getRelayError(error) }).catch(() => undefined);
  }
}

function canRetryMainRelay(attemptCount: number, expiresAt: Date | null) {
  return attemptCount < operationalConfig.pushNotifications.outboxMaxAttempts &&
    (!expiresAt || expiresAt.getTime() > Date.now());
}

function getNextRelayAttemptAt(attemptCount: number) {
  return new Date(Date.now() + getPushRetryDelayMs(
    attemptCount,
    operationalConfig.pushNotifications.outboxMaxRetrySeconds,
  ));
}

function getRelayExpiry(type: 'message' | 'incoming-call' | 'call-ended') {
  const ttlMs = type === 'message'
    ? operationalConfig.pushNotifications.messageTtlHours * 60 * 60 * 1000
    : type === 'incoming-call' ? 30_000 : 5 * 60_000;
  return new Date(Date.now() + ttlMs);
}

async function completeMainRelayJob(jobId: string, domainId: string | null, status: string, result: {
  acceptedCount?: number;
  error?: string;
  failedCount?: number;
  invalidTokenIds?: string[];
  skippedCount?: number;
}) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ receivedCount: number }>>`
      select "receivedCount" from "PushRelayJob" where id = ${jobId} for update
    `;
    await tx.pushRelayJob.update({
      data: {
        acceptedCount: { increment: result.acceptedCount ?? 0 },
        completedAt: new Date(),
        error: result.error ?? null,
        failedCount: result.failedCount ?? 0,
        invalidTokenIds: result.invalidTokenIds ?? [],
        payload: Prisma.JsonNull,
        skippedCount: result.skippedCount ?? 0,
        status: (rows[0]?.receivedCount ?? 0) > 0 ? 'DEVICE_RECEIVED' : status,
      },
      where: { id: jobId },
    });
    if (domainId) await tx.pushRelayStatusEvent.create({ data: { domainId, jobId } });
  });
}

function getRelayError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function getCompletedRelayStatus(result: PushDispatchResult) {
  if (result.acceptedCount > 0 && (result.failedCount > 0 || result.skippedCount > 0)) {
    return 'PARTIAL';
  }
  if (result.acceptedCount > 0) {
    return 'PROVIDER_ACCEPTED';
  }
  return 'FAILED';
}

function assertDeliveryReceiptOrigins(tokens: Array<{ deliveryReceiptUrl?: string }>, expectedHostname: string) {
  const expectedOrigin = new URL(expectedHostname).origin;
  const hasInvalidOrigin = tokens.some((token) => (
    token.deliveryReceiptUrl && new URL(token.deliveryReceiptUrl).origin !== expectedOrigin
  ));
  if (hasInvalidOrigin) {
    throw new HttpError(400, 'Push delivery receipt URL must use the child server hostname');
  }
}

async function authenticateChildRequest(req: Request) {
  if (operationalConfig.serverRole !== 'main') {
    throw new HttpError(404, 'Route not found');
  }

  const rawKey = req.get('x-meetvap-main-server-key') ?? '';
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const domain = await prisma.loginDomain.findFirst({ where: { mainServerKeyHash: keyHash } });
  const requestIp = normalizeIp(getRequestIp(req));

  if (!domain || !domain.isActive || (domain.expiresAt && domain.expiresAt <= new Date())) {
    throw new HttpError(403, 'Child server is not authorized');
  }
  if (!domain.originIpAddresses.map(normalizeIp).includes(requestIp)) {
    throw new HttpError(403, 'Child server origin IP is not allowed');
  }

  return domain;
}

async function upsertChildServerUser(
  domainId: string,
  snapshot: z.infer<typeof childUserSnapshotSchema>,
) {
  const data = {
    appBuildNumber: snapshot.appBuildNumber ?? null,
    appVersion: snapshot.appVersion ?? null,
    avatarUrl: snapshot.avatarUrl ?? null,
    childCreatedAt: new Date(snapshot.childCreatedAt),
    childUpdatedAt: new Date(snapshot.childUpdatedAt),
    deviceModel: snapshot.deviceModel ?? null,
    displayName: snapshot.displayName,
    installationId: snapshot.installationId ?? null,
    lastLoginAt: snapshot.lastLoginAt ? new Date(snapshot.lastLoginAt) : null,
    lastSeenAt: snapshot.lastSeenAt ? new Date(snapshot.lastSeenAt) : null,
    lastSyncedAt: new Date(),
    latestLocale: snapshot.latestLocale ?? null,
    latestPlatform: snapshot.latestPlatform ?? null,
    osVersion: snapshot.osVersion ?? null,
    registrationIpAddress: snapshot.registrationIpAddress ?? null,
    registrationLocale: snapshot.registrationLocale ?? null,
    registrationPlatform: snapshot.registrationPlatform ?? null,
    registrationUserAgent: snapshot.registrationUserAgent ?? null,
    username: snapshot.username,
  };

  await prisma.childServerUser.upsert({
    create: {
      ...data,
      childUserId: snapshot.childUserId,
      domainId,
    },
    update: {
      ...data,
      deletedAt: null,
    },
    where: {
      domainId_childUserId: {
        childUserId: snapshot.childUserId,
        domainId,
      },
    },
  });
}

function getDeletionChildUserId(snapshot: unknown) {
  const parsed = z.object({ childUserId: z.string().min(1).max(128) }).safeParse(snapshot);

  if (!parsed.success) {
    throw new HttpError(400, 'Deletion event requires childUserId');
  }

  return parsed.data.childUserId;
}

function getUntrustedEventId(value: unknown) {
  if (!value || typeof value !== 'object' || !('eventId' in value)) {
    return null;
  }

  return typeof value.eventId === 'string' ? value.eventId.slice(0, 128) : null;
}

function decodeStatusCursor(value?: string | null) {
  if (!value) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, 'Invalid push status cursor');
  }
  return BigInt(value);
}

function getRequestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || '';
}

function normalizeIp(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}
