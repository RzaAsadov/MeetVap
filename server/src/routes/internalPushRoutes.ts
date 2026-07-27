import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Request, Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../httpError';
import { operationalConfig } from '../operationalConfig';
import { prisma } from '../prisma';
import { PushDispatchResult, sendCallEndedPush, sendIncomingCallPush, sendMessagePush } from '../pushNotifications';

export const internalPushRoutes = Router();

const tokenSchema = z.object({
  deliveryReceiptUrl: z.string().url().max(2048).optional(),
  id: z.string().max(128).optional(),
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
        status: 'QUEUED',
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
      status: 'PROCESSING',
    },
    where: {
      id: jobId,
      status: 'QUEUED',
    },
  });

  if (claimed.count === 0) {
    return;
  }

  let domainId: string | null = null;

  try {
    const job = await prisma.pushRelayJob.findUniqueOrThrow({ where: { id: jobId } });
    domainId = job.domainId;
    const payload = relaySchema.parse(job.payload);
    let result: PushDispatchResult;

    if (payload.type === 'message') result = await sendMessagePush(payload.input);
    else if (payload.type === 'incoming-call') result = await sendIncomingCallPush(payload.input);
    else result = await sendCallEndedPush(payload.input);

    await prisma.$transaction(async (tx) => {
      await tx.pushRelayJob.update({
        data: {
          acceptedCount: result.acceptedCount,
          completedAt: new Date(),
          failedCount: result.failedCount,
          invalidTokenIds: result.invalidTokenIds,
          payload: Prisma.JsonNull,
          skippedCount: result.skippedCount,
          status: getCompletedRelayStatus(result),
        },
        where: { id: jobId },
      });
      if (domainId) {
        await tx.pushRelayStatusEvent.create({ data: { domainId, jobId } });
      }
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.pushRelayJob.update({
        data: {
          completedAt: new Date(),
          error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
          status: 'FAILED',
        },
        where: { id: jobId },
      });
      if (domainId) {
        await tx.pushRelayStatusEvent.create({ data: { domainId, jobId } });
      }
    }).catch(() => undefined);
  }
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
