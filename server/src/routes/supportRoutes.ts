import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { config } from '../config';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { sendMessagePush } from '../pushNotifications';
import { serializeMessage } from '../serializers';
import { recordMessageStats } from '../stats';
import { getMeetVapSystemUserId } from '../systemAccount';

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

async function ensureSupportReplyAdminTable() {
  await prisma.$executeRaw`
    create table if not exists "SupportTicketReplyAdmin" (
      "messageId" text primary key references "Message"(id) on delete cascade,
      "adminUsername" text,
      "createdAt" timestamp(3) not null default current_timestamp
    )
  `;
}

async function sendSupportReplyPush(input: {
  body: string;
  conversationId: string;
  messageId: string;
  recipientUserId: string;
}) {
  const tokens = await prisma.devicePushToken.findMany({
    select: {
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
