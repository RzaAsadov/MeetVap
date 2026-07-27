import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { Router } from 'express';

import { config } from '../config';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { sendMessagePush } from '../pushNotifications';
import { cacheDeletePattern } from '../redisCache';
import { serializeMessage } from '../serializers';
import { recordMessageStats } from '../stats';
import { getMeetVapSystemUserId } from '../systemAccount';
import { editMessageSchema } from '../validators';

export const supportRoutes = Router();

supportRoutes.post('/internal/conversations/:conversationId/messages', async (req, res, next) => {
  try {
    if (!config.SERVER_EVENTS_INTERNAL_SECRET) {
      throw new HttpError(404, 'Route not found');
    }

    const secret = req.get('x-meetvap-internal-secret') ?? '';

    if (secret !== config.SERVER_EVENTS_INTERNAL_SECRET) {
      throw new HttpError(403, 'Forbidden');
    }

    const conversationId = String(req.params.conversationId ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    const adminUsername = String(req.body?.adminUsername ?? '').trim().slice(0, 80);

    if (!conversationId) {
      throw new HttpError(400, 'Missing conversationId');
    }

    if (!body) {
      throw new HttpError(400, 'Missing message body');
    }

    const supportUserId = await getMeetVapSystemUserId();
    const conversation = await prisma.conversation.findFirst({
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
      where: {
        id: conversationId,
        type: 'DIRECT',
        members: { some: { userId: supportUserId } },
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Support conversation not found');
    }

    const recipient = conversation.members.find((member) => member.userId !== supportUserId);

    if (!recipient) {
      throw new HttpError(404, 'Support recipient not found');
    }

    await ensureSupportReplyAdminTable();
    const sentAt = new Date();
    const metadata = {
      adminBody: body,
      deleteKey: createMessageDeleteKey(),
      source: 'support_admin',
    };

    const message = await prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({
        data: {
          body,
          conversationId,
          createdAt: sentAt,
          kind: 'TEXT',
          metadata: metadata as Prisma.InputJsonValue,
          senderId: supportUserId,
        },
        include: {
          media: true,
          sender: {
            select: {
              avatarUrl: true,
              displayName: true,
              id: true,
              username: true,
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
        where: { id: conversationId },
      });
      await tx.conversationMember.update({
        data: { lastReadAt: sentAt },
        where: {
          conversationId_userId: {
            conversationId,
            userId: supportUserId,
          },
        },
      });
      await tx.conversationDeletion.deleteMany({
        where: {
          conversationId,
          deletedAt: { lte: sentAt },
        },
      });
      await recordMessageStats(tx, {
        kind: 'TEXT',
        senderId: supportUserId,
      });
      await tx.$executeRaw`
        insert into "SupportTicketReplyAdmin" ("messageId", "adminUsername", "createdAt")
        values (${createdMessage.id}, ${adminUsername || null}, ${sentAt})
        on conflict ("messageId") do update set "adminUsername" = excluded."adminUsername"
      `;

      return createdMessage;
    });

    const serializedMessage = serializeMessage(message);
    const io = req.app.get('io');
    const memberRooms = conversation.members.map((member) => `user:${member.userId}`);

    io?.to(conversationId).to(memberRooms).emit('message:new', serializedMessage);
    io?.to(memberRooms).emit('conversation:updated', { conversationId });

    void sendSupportReplyPush({
      body,
      conversationId,
      messageId: message.id,
      recipientUserId: recipient.userId,
    }).catch((error) => {
      console.warn('Could not send support reply push notification', error);
    });

    res.status(201).json({ message: serializedMessage, ok: true });
  } catch (error) {
    next(error);
  }
});

supportRoutes.patch('/internal/conversations/:conversationId/messages/:messageId', async (req, res, next) => {
  try {
    assertInternalSupportRequest(req.get('x-meetvap-internal-secret'));

    const conversationId = String(req.params.conversationId ?? '').trim();
    const messageId = String(req.params.messageId ?? '').trim();
    const input = editMessageSchema.parse(req.body);
    const adminUsername = String(req.body?.adminUsername ?? '').trim().slice(0, 80);

    if (!conversationId || !messageId) {
      throw new HttpError(400, 'Missing support message identifiers');
    }

    await ensureSupportReplyAdminTable();
    const supportUserId = await getMeetVapSystemUserId();
    const message = await prisma.message.findFirst({
      include: {
        conversation: {
          select: {
            lastMessageAt: true,
            lastMessageKind: true,
            lastMessageSenderId: true,
            members: { select: { userId: true } },
            type: true,
          },
        },
      },
      where: {
        conversationId,
        deletedAt: null,
        id: messageId,
        senderId: supportUserId,
      },
    });

    if (!message || message.conversation.type !== 'DIRECT') {
      throw new HttpError(404, 'Support reply not found');
    }

    const metadata = getMetadataObject(message.metadata);
    const auditRows = await prisma.$queryRaw<Array<{ messageId: string }>>`
      select "messageId"
      from "SupportTicketReplyAdmin"
      where "messageId" = ${message.id}
      limit 1
    `;

    if (metadata.source !== 'support_admin' && auditRows.length === 0) {
      throw new HttpError(403, 'Only admin support replies can be edited here');
    }

    if (message.kind !== 'TEXT' || message.mediaId) {
      throw new HttpError(400, 'Only text support replies can be edited');
    }

    const editedAt = new Date();
    const messageKey = typeof metadata.deleteKey === 'string' && /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
      ? metadata.deleteKey
      : createMessageDeleteKey();
    const updatedMetadata = {
      ...metadata,
      adminBody: input.body,
      deleteKey: messageKey,
      editedAt: editedAt.toISOString(),
      source: 'support_admin',
    };
    const isConversationPreviewMessage = message.conversation.lastMessageKind === message.kind &&
      message.conversation.lastMessageSenderId === message.senderId &&
      message.conversation.lastMessageAt?.getTime() === message.createdAt.getTime();
    const updatedMessage = await prisma.$transaction(async (tx) => {
      const nextMessage = await tx.message.update({
        data: {
          body: input.body,
          metadata: updatedMetadata as Prisma.InputJsonValue,
        },
        where: { id: message.id },
      });

      if (isConversationPreviewMessage) {
        await tx.conversation.update({
          data: { lastMessageBody: input.body },
          where: { id: conversationId },
        });
      }

      await tx.messageContentAck.deleteMany({
        where: {
          messageId: message.id,
          userId: { not: supportUserId },
        },
      });
      await tx.$executeRaw`
        insert into "SupportTicketReplyAdmin" (
          "messageId", "adminUsername", "editedAt", "editedByAdminUsername", "createdAt"
        )
        values (${message.id}, null, ${editedAt}, ${adminUsername || null}, ${message.createdAt})
        on conflict ("messageId") do update set
          "editedAt" = excluded."editedAt",
          "editedByAdminUsername" = excluded."editedByAdminUsername"
      `;

      return nextMessage;
    });
    const clientMetadata: Record<string, Prisma.JsonValue | undefined> = { ...updatedMetadata };
    delete clientMetadata.adminBody;
    delete clientMetadata.adminUsername;
    const recipients = await queueSupportMessageEditRequest({
      body: input.body,
      conversationId,
      messageId: message.id,
      messageKey,
      metadata: clientMetadata as Prisma.InputJsonValue,
      requestedById: supportUserId,
    });
    const editPayload = {
      body: input.body,
      conversationId,
      createdAt: message.createdAt.toISOString(),
      messageId: message.id,
      messageKey,
      metadata: clientMetadata,
      requestedById: supportUserId,
      updatedAt: updatedMessage.updatedAt.toISOString(),
    };
    const memberRooms = message.conversation.members.map((member) => `user:${member.userId}`);
    const io = req.app.get('io');

    await Promise.all(message.conversation.members.map((member) => (
      cacheDeletePattern(`conversation-list:${member.userId}:*`)
    )));
    io?.to(conversationId).to(memberRooms).to(recipients.map((recipient) => `user:${recipient.userId}`)).emit('message:edited', editPayload);
    io?.to(memberRooms).emit('conversation:updated', { conversationId });

    res.json({ edit: editPayload, ok: true });
  } catch (error) {
    next(error);
  }
});

async function ensureSupportReplyAdminTable() {
  await prisma.$executeRaw`
    create table if not exists "SupportTicketReplyAdmin" (
      "messageId" text primary key references "Message"(id) on delete cascade,
      "adminUsername" text,
      "editedByAdminUsername" text,
      "editedAt" timestamp(3),
      "createdAt" timestamp(3) not null default current_timestamp
    )
  `;
  await prisma.$executeRaw`
    alter table "SupportTicketReplyAdmin"
      add column if not exists "editedByAdminUsername" text,
      add column if not exists "editedAt" timestamp(3)
  `;
}

function assertInternalSupportRequest(rawSecret?: string) {
  if (!config.SERVER_EVENTS_INTERNAL_SECRET) {
    throw new HttpError(404, 'Route not found');
  }

  if ((rawSecret ?? '') !== config.SERVER_EVENTS_INTERNAL_SECRET) {
    throw new HttpError(403, 'Forbidden');
  }
}

function createMessageDeleteKey() {
  return crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).padEnd(16, '0');
}

function getMetadataObject(metadata: Prisma.JsonValue | null) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, Prisma.JsonValue>
    : {};
}

async function queueSupportMessageEditRequest(input: {
  body: string;
  conversationId: string;
  messageId: string;
  messageKey: string;
  metadata: Prisma.InputJsonValue;
  requestedById: string;
}) {
  const recipients = await prisma.conversationMember.findMany({
    select: { userId: true },
    where: {
      conversationId: input.conversationId,
      userId: { not: input.requestedById },
    },
  });

  await Promise.all(recipients.map((recipient) => prisma.messageEditRequest.upsert({
    create: {
      body: input.body,
      conversationId: input.conversationId,
      messageId: input.messageId,
      messageKey: input.messageKey,
      metadata: input.metadata,
      requestedById: input.requestedById,
      userId: recipient.userId,
    },
    update: {
      body: input.body,
      createdAt: new Date(),
      messageId: input.messageId,
      metadata: input.metadata,
      requestedById: input.requestedById,
    },
    where: {
      conversationId_messageKey_userId: {
        conversationId: input.conversationId,
        messageKey: input.messageKey,
        userId: recipient.userId,
      },
    },
  })));

  return recipients;
}

async function sendSupportReplyPush(input: {
  body: string;
  conversationId: string;
  messageId: string;
  recipientUserId: string;
}) {
  const tokens = await prisma.devicePushToken.findMany({
    select: {
      id: true,
      locale: true,
      platform: true,
      provider: true,
      token: true,
    },
    where: {
      userId: input.recipientUserId,
      user: {
        memberships: {
          some: {
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
    body: input.body,
    conversationId: input.conversationId,
    messageId: input.messageId,
    title: 'MeetVap',
    tokens,
  });
}
