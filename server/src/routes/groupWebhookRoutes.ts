import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Request, Router } from 'express';
import type { Server } from 'socket.io';
import { ZodError } from 'zod';

import { HttpError } from '../httpError';
import { operationalConfig } from '../operationalConfig';
import { prisma } from '../prisma';
import { sendMessagePush } from '../pushNotifications';
import { enforceRateLimit } from '../rateLimits';
import { serializeMessage } from '../serializers';
import { recordMessageStats } from '../stats';
import { getMeetVapSystemUserId } from '../systemAccount';
import { groupWebhookMessageSchema } from '../validators';

export const groupWebhookRoutes = Router();

type GroupWebhookRow = {
  avatarUrl: string | null;
  conversationId: string;
  id: string;
  name: string;
  title: string | null;
};

groupWebhookRoutes.post('/:token/messages', async (req, res, next) => {
  let webhook: GroupWebhookRow | null = null;

  try {
    const token = String(req.params.token ?? '').trim();

    if (!isValidWebhookToken(token)) {
      throw new HttpError(404, 'Webhook not found');
    }

    webhook = await findActiveGroupWebhook(token);

    if (!webhook) {
      throw new HttpError(404, 'Webhook not found');
    }

    const activeWebhook = webhook;
    const text = getWebhookText(req.body);
    const input = groupWebhookMessageSchema.parse({ text });
    await enforceRateLimit(
      activeWebhook.id,
      'group-webhook-message',
      operationalConfig.rateLimits.textMessagesPerMinute,
    );

    const senderId = await getMeetVapSystemUserId();
    const sentAt = new Date();
    const metadata = {
      source: 'group_webhook',
      webhookId: activeWebhook.id,
      webhookName: activeWebhook.name,
    };

    const message = await prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({
        data: {
          body: input.text,
          conversationId: activeWebhook.conversationId,
          createdAt: sentAt,
          kind: 'TEXT',
          metadata: metadata as Prisma.InputJsonValue,
          senderId,
        },
        include: {
          conversation: {
            include: {
              members: {
                select: {
                  aliasName: true,
                  aliasPromptSeen: true,
                  lastReadAt: true,
                  userId: true,
                },
              },
            },
          },
          media: true,
          sender: {
            select: {
              avatarUrl: true,
              displayName: true,
              hideFromSearch: true,
              hideNickname: true,
              id: true,
              lastSeenAt: true,
              preventPeerScreenshots: true,
              showLastSeen: true,
              username: true,
              useGroupAliases: true,
            },
          },
        },
      });

      await tx.conversation.update({
        data: {
          lastMessageAt: sentAt,
          lastMessageBody: createdMessage.body,
          lastMessageKind: createdMessage.kind,
          lastMessageSenderId: createdMessage.senderId,
          lastMessageStatus: createdMessage.status,
          updatedAt: sentAt,
        },
        where: { id: activeWebhook.conversationId },
      });
      await tx.conversationDeletion.deleteMany({
        where: {
          conversationId: activeWebhook.conversationId,
          deletedAt: { lte: sentAt },
        },
      });
      await tx.$executeRaw`
        update "GroupWebhook"
        set "lastUsedAt" = ${sentAt}, "updatedAt" = ${sentAt}
        where id = ${activeWebhook.id}
      `;
      await tx.$executeRaw`
        insert into "GroupWebhookDelivery" (
          id,
          "webhookId",
          "conversationId",
          "messageId",
          status,
          "bodyPreview",
          "ipAddress",
          "userAgent",
          "createdAt"
        ) values (
          ${createId()},
          ${activeWebhook.id},
          ${activeWebhook.conversationId},
          ${createdMessage.id},
          'ACCEPTED',
          ${input.text.slice(0, 240)},
          ${getClientIp(req)},
          ${String(req.get('user-agent') ?? '').slice(0, 500) || null},
          ${sentAt}
        )
      `;
      await recordMessageStats(tx, {
        kind: 'TEXT',
        senderId,
      });

      return createdMessage;
    });

    const io = req.app.get('io') as Server | undefined;
    const memberRooms = message.conversation.members
      .filter((member) => member.aliasPromptSeen === true)
      .map((member) => `user:${member.userId}`);
    const serializedMessage = serializeMessage(message);

    io?.to(activeWebhook.conversationId).to(memberRooms).emit('message:new', serializedMessage);
    io?.to(memberRooms).emit('conversation:updated', { conversationId: activeWebhook.conversationId });
    void sendWebhookMessageNotification({
      avatarUrl: activeWebhook.avatarUrl,
      body: input.text,
      conversationId: activeWebhook.conversationId,
      messageId: message.id,
      title: activeWebhook.title ? `${activeWebhook.name} • ${activeWebhook.title}` : activeWebhook.name,
    }).catch((error) => {
      console.warn('Could not send group webhook push notification', error);
    });

    res.status(201).json({ message: serializedMessage, ok: true });
  } catch (error) {
    if (webhook && isAuditableWebhookError(error)) {
      await recordFailedDelivery(webhook, req, error).catch((deliveryError) => {
        console.warn('Could not record failed group webhook delivery', deliveryError);
      });
    }

    next(error);
  }
});

function isValidWebhookToken(token: string) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(token);
}

function getWebhookText(body: unknown) {
  if (body && typeof body === 'object') {
    const candidate = body as { body?: unknown; text?: unknown };

    if (typeof candidate.text === 'string') {
      return candidate.text;
    }

    if (typeof candidate.body === 'string') {
      return candidate.body;
    }
  }

  return '';
}

async function findActiveGroupWebhook(token: string) {
  const tokenHash = hashWebhookToken(token);
  const rows = await prisma.$queryRaw<GroupWebhookRow[]>`
    select
      gw.id,
      gw."conversationId",
      gw.name,
      c.title,
      c."avatarUrl"
    from "GroupWebhook" gw
    join "Conversation" c on c.id = gw."conversationId"
    where gw."tokenHash" = ${tokenHash}
      and gw.enabled = true
      and gw."revokedAt" is null
      and c.type = 'GROUP'::"ConversationType"
    limit 1
  `;

  return rows[0] ?? null;
}

function hashWebhookToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function sendWebhookMessageNotification(input: {
  avatarUrl?: string | null;
  body: string;
  conversationId: string;
  messageId: string;
  title: string;
}) {
  const tokens = await prisma.devicePushToken.findMany({
    select: {
      locale: true,
      platform: true,
      provider: true,
      token: true,
    },
    where: {
      user: {
        memberships: {
          some: {
            aliasPromptSeen: true,
            conversationId: input.conversationId,
            OR: [
              { mutedAt: null },
              { mutedUntil: { lte: new Date() } },
            ],
          },
        },
      },
    },
  });

  await sendMessagePush({
    avatarUrl: input.avatarUrl,
    body: input.body,
    conversationId: input.conversationId,
    messageId: input.messageId,
    title: input.title,
    tokens,
  });
}

async function recordFailedDelivery(webhook: GroupWebhookRow, req: Request, error: unknown) {
  const text = getWebhookText(req.body);
  await prisma.$executeRaw`
    insert into "GroupWebhookDelivery" (
      id,
      "webhookId",
      "conversationId",
      status,
      "bodyPreview",
      error,
      "ipAddress",
      "userAgent",
      "createdAt"
    ) values (
      ${createId()},
      ${webhook.id},
      ${webhook.conversationId},
      'FAILED',
      ${typeof text === 'string' ? text.slice(0, 240) : null},
      ${getErrorMessage(error).slice(0, 500)},
      ${getClientIp(req)},
      ${String(req.get('user-agent') ?? '').slice(0, 500) || null},
      ${new Date()}
    )
  `;
}

function isAuditableWebhookError(error: unknown) {
  if (error instanceof ZodError) {
    return true;
  }

  return error instanceof HttpError && error.statusCode !== 404;
}

function getErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    return 'Validation failed';
  }

  return error instanceof Error ? error.message : 'Unknown error';
}

function getClientIp(req: { ip?: string; ips?: string[]; get(name: string): string | undefined }) {
  return (req.ips?.[0] || req.ip || '').slice(0, 80) || null;
}

function createId() {
  return `c${Date.now().toString(36)}${crypto.randomBytes(12).toString('hex')}`;
}
