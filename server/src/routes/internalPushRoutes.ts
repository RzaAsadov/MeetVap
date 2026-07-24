import crypto from 'crypto';
import { Request, Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../httpError';
import { operationalConfig } from '../operationalConfig';
import { prisma } from '../prisma';
import { sendCallEndedPush, sendIncomingCallPush, sendMessagePush } from '../pushNotifications';

export const internalPushRoutes = Router();

const tokenSchema = z.object({
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

internalPushRoutes.post('/child-push', async (req, res, next) => {
  try {
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

    const payload = relaySchema.parse(req.body);
    if (payload.type === 'message') await sendMessagePush(payload.input);
    if (payload.type === 'incoming-call') await sendIncomingCallPush(payload.input);
    if (payload.type === 'call-ended') await sendCallEndedPush(payload.input);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function getRequestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || '';
}

function normalizeIp(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}
