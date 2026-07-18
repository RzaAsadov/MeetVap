import { Prisma, SubscriptionEntitlement } from '@prisma/client';
import type { Server } from 'socket.io';

import { config } from './config';
import { prisma } from './prisma';
import { sendMessagePush } from './pushNotifications';
import { serializeMessage } from './serializers';
import { recordMessageStats } from './stats';
import { getMeetVapServerUserId } from './systemAccount';

type RegisteredUserEventInput = {
  io?: Server;
  occurredAt?: Date;
  platform?: string | null;
  user: {
    displayName: string;
    id: string;
    username: string;
  };
};

type SubscriptionEventInput = {
  entitlement: Pick<SubscriptionEntitlement, 'expiresAt' | 'id' | 'lastVerifiedAt' | 'platform' | 'productId' | 'status' | 'userId'> & {
    manualGrantedByUsername?: string | null;
  };
  io?: Server;
};

type LiveKitNodeHealthEventInput = {
  checkedAt?: Date;
  error?: string | null;
  io?: Server;
  server: {
    id: string;
    url: string;
  };
  status?: number | null;
  state: 'down' | 'up';
};

type SupportTicketEventInput = {
  io?: Server;
  messageId: string;
  user: {
    displayName: string;
    id: string;
    username: string;
  };
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['ACTIVE', 'GRACE']);

export async function notifyServerUserRegistered(input: RegisteredUserEventInput) {
  return sendServerEventToGroup({
    body: [
      'Yeni kullanıcı kaydı',
      '',
      `Görünen ad: ${input.user.displayName}`,
      `Kullanıcı adı: ${input.user.username}`,
      `Platform: ${formatPlatform(input.platform)}`,
      `Tarih: ${formatTurkishDate(input.occurredAt ?? new Date())}`,
    ].join('\n'),
    dedupeKey: `registration:${input.user.id}`,
    eventType: 'user_registered',
    targetConversationId: config.SERVER_EVENTS_GROUP_ID,
    io: input.io,
  });
}

export async function notifyServerUserSubscribed(input: SubscriptionEventInput) {
  const entitlement = input.entitlement;

  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(entitlement.status) || entitlement.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  const user = await prisma.user.findUnique({
    select: {
      displayName: true,
      username: true,
    },
    where: { id: entitlement.userId },
  });

  if (!user) {
    return false;
  }

  const manualAdminLine = String(entitlement.platform) === 'MANUAL' && entitlement.manualGrantedByUsername
    ? [`Ekleyen admin: ${entitlement.manualGrantedByUsername}`]
    : [];

  return sendServerEventToGroup({
    body: [
      'Yeni abonelik',
      '',
      `Görünen ad: ${user.displayName}`,
      `Kullanıcı adı: ${user.username}`,
      `Platform: ${formatPlatform(entitlement.platform)}`,
      ...manualAdminLine,
      `Ürün: ${entitlement.productId}`,
      `Bitiş tarihi: ${formatTurkishDate(entitlement.expiresAt)}`,
      `İşlem tarihi: ${formatTurkishDate(entitlement.lastVerifiedAt ?? new Date())}`,
    ].join('\n'),
    dedupeKey: [
      'subscription',
      entitlement.id,
      entitlement.status,
      entitlement.expiresAt.toISOString(),
    ].join(':'),
    eventType: 'user_subscribed',
    targetConversationId: config.SERVER_EVENTS_GROUP_ID,
    io: input.io,
  });
}

export async function notifyServerSubscriptionEntitlementById(entitlementId: string, io?: Server) {
  const entitlement = await prisma.subscriptionEntitlement.findUnique({
    where: { id: entitlementId },
  });

  if (!entitlement) {
    return false;
  }

  const manualRows = await prisma.$queryRaw<Array<{ manualGrantedByUsername: string | null }>>`
    select "manualGrantedByUsername"
    from "SubscriptionEntitlement"
    where id = ${entitlementId}
    limit 1
  `;

  return notifyServerUserSubscribed({
    entitlement: {
      ...entitlement,
      manualGrantedByUsername: manualRows[0]?.manualGrantedByUsername ?? null,
    },
    io,
  });
}

export async function notifyServerLiveKitNodeHealthChanged(input: LiveKitNodeHealthEventInput) {
  const checkedAt = input.checkedAt ?? new Date();
  const statusLine = input.status ? [`HTTP durumu: ${input.status}`] : [];
  const errorLine = input.error ? [`Hata: ${input.error}`] : [];
  const isDown = input.state === 'down';

  return sendServerEventToGroup({
    body: [
      isDown ? 'LiveKit düğümü çevrim dışı' : 'LiveKit düğümü tekrar çevrim içi',
      '',
      `Sunucu: ${input.server.id}`,
      `Adres: ${input.server.url}`,
      ...statusLine,
      ...errorLine,
      `Tarih: ${formatTurkishDate(checkedAt)}`,
    ].join('\n'),
    dedupeKey: [
      'livekit_node_health',
      input.server.id,
      input.state,
      checkedAt.toISOString(),
    ].join(':'),
    eventType: isDown ? 'livekit_node_down' : 'livekit_node_up',
    targetConversationId: config.SERVER_EVENTS_LIVEKIT_ID,
    pushTitle: 'Meetvap LiveKit',
    io: input.io,
  });
}

export async function notifyServerSupportTicketCreated(input: SupportTicketEventInput) {
  return sendServerEventToGroup({
    body: [
      'Yeni destek talebi',
      '',
      `Görünen ad: ${input.user.displayName}`,
      `Kullanıcı adı: ${input.user.username}`,
    ].join('\n'),
    dedupeKey: `support_ticket:${input.messageId}`,
    eventType: 'support_ticket_created',
    pushTitle: 'MeetVap Support',
    targetConversationId: config.SERVER_EVENTS_SUPPORT_ID,
    io: input.io,
  });
}

async function sendServerEventToGroup(input: {
  body: string;
  dedupeKey: string;
  eventType: string;
  io?: Server;
  pushTitle?: string;
  targetConversationId?: string;
}) {
  const conversationId = input.targetConversationId;

  if (!conversationId) {
    return false;
  }

  const senderId = await getMeetVapServerUserId();
  const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
    select id
    from "Message"
    where "conversationId" = ${conversationId}
      and "senderId" = ${senderId}
      and metadata->>'source' = 'server_event'
      and metadata->>'dedupeKey' = ${input.dedupeKey}
    limit 1
  `;

  if (existingRows.length > 0) {
    return true;
  }

  const sentAt = new Date();
  const metadata = {
    dedupeKey: input.dedupeKey,
    eventType: input.eventType,
    source: 'server_event',
  };

  const message = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      select: { id: true },
      where: {
        id: conversationId,
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new Error(`Server events group not found: ${conversationId}`);
    }

    const createdMessage = await tx.message.create({
      data: {
        body: input.body,
        conversationId,
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
    await tx.conversationDeletion.deleteMany({
      where: {
        conversationId,
        deletedAt: { lte: sentAt },
      },
    });
    await recordMessageStats(tx, {
      kind: 'TEXT',
      senderId,
    });

    return createdMessage;
  });

  const memberRooms = message.conversation.members
    .filter((member) => member.aliasPromptSeen === true)
    .map((member) => `user:${member.userId}`);
  const serializedMessage = serializeMessage(message);

  input.io?.to(conversationId).to(memberRooms).emit('message:new', serializedMessage);
  input.io?.to(memberRooms).emit('conversation:updated', { conversationId });
  void sendServerEventPush({
    body: input.body,
    conversationId,
    messageId: message.id,
    title: input.pushTitle ?? 'Meetvap Server',
  }).catch((error) => {
    console.warn('Could not send server event push notification', error);
  });

  return true;
}

async function sendServerEventPush(input: {
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
    body: input.body,
    conversationId: input.conversationId,
    messageId: input.messageId,
    title: input.title,
    tokens,
  });
}

function formatPlatform(platform?: string | null) {
  const normalized = platform?.trim();

  return normalized ? normalized.toUpperCase() : 'Bilinmiyor';
}

function formatTurkishDate(date: Date) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
  }).format(date);
}
