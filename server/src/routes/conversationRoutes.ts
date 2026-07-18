import { ConversationMember, Message, MessageKind, MessageStatus, Prisma, ScheduledMessage, StatusAudience, StatusUpdate } from '@prisma/client';
import { NextFunction, Request, Response, Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import crypto from 'crypto';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import path from 'path';
import type { Server } from 'socket.io';

import { getAuthedUser, isAdminBlocked, requireAuth } from '../auth';
import { getAvatarMediaId, isAvatarMediaReferenced } from '../avatarMedia';
import { areUsersHardDeleteReady } from '../clientCompatibility';
import { getMessageClientKind, normalizeMessageClient, type MessageClientIdentity } from '../clientActivity';
import { config } from '../config';
import { HttpError } from '../httpError';
import { createUniqueGroupInviteCode } from '../groupInviteCodes';
import { selectLiveKitServerForRoom } from '../livekitPool';
import { prisma } from '../prisma';
import { sendMessagePush } from '../pushNotifications';
import { serializeConversation, serializeMessage } from '../serializers';
import { notifyServerSupportTicketCreated } from '../serverEventMessages';
import { recordMessageStats } from '../stats';
import { getPremiumFeatureAccessMap, hasPremiumFeatureAccess, requirePremiumFeatureAccess } from '../subscriptions';
import { ensureMeetVapDirectConversationForUser, getMeetVapSystemUserId } from '../systemAccount';
import { assertNotBlockedBetween } from './userRoutes';
import { bulkConversationAckSchema, bulkConversationSyncSchema, bulkDeleteConversationsSchema, createDirectConversationSchema, createGroupConversationSchema, createMessageSchema, createScheduledMessageSchema, declineGroupInviteSchema, deleteConversationSchema, deleteMessageSchema, editMessageSchema, messageDeletionAckSchema, messageIdsSchema, messageReactionSchema, openDisappearingMessageSchema, quickReplySchema, transferGroupOwnershipSchema, updateConversationMuteSchema, updateDisappearingMessagesSchema, updateGroupAliasSchema, updateGroupAvatarSchema, updateGroupMembersSchema, updateGroupSettingsSchema, updateGroupTitleSchema, updateVoiceRoomParticipantSchema } from '../validators';
import { operationalConfig } from '../operationalConfig';
import { enforceRateLimit } from '../rateLimits';
import { cacheDeletePattern, cacheGetJson, cacheSetJson } from '../redisCache';
import {
  buildConversationListWhere,
  countUnreadConversationsForUser,
  countUnreadMessagesByConversationForUser,
  listUnreadConversationIdsForUser,
  parseConversationListFilter,
} from '../conversationList';

export const conversationRoutes = Router();
const uploadDir = path.resolve(config.UPLOAD_DIR);
const DISAPPEARING_MESSAGE_CLEANUP_BATCH_SIZE = 100;
const DISAPPEARING_MESSAGE_CLEANUP_MAX_PER_RUN = 250;
const SCHEDULED_MESSAGE_DELIVERY_BATCH_SIZE = 50;
const VIEW_DISAPPEARING_MESSAGE_CLEANUP_BATCH_SIZE = 100;
const RECEIPT_WRITE_BATCH_SIZE = 50;
const CONVERSATION_LIST_CACHE_TTL_SECONDS = 8;
const HOUR_MS = 60 * 60 * 1000;
type CreateConversationMessageInput = ReturnType<typeof createMessageSchema.parse>;

conversationRoutes.get('/public-invites/:inviteCode', async (req, res, next) => {
  try {
    const inviteCode = String(req.params.inviteCode ?? '').trim();
    const rows = await prisma.$queryRaw<Array<{
      avatarUrl: string | null;
      id: string;
      memberCount: bigint | number;
      title: string | null;
    }>>`
      select c."avatarUrl", c."id", c."title", count(cm."userId") as "memberCount"
      from "Conversation" c
      left join "ConversationMember" cm on cm."conversationId" = c."id" and cm."aliasPromptSeen" = true
      where c."type" = 'GROUP'::"ConversationType"
        and c."isPublic" = true
        and c."publicInviteCode" = ${inviteCode}
      group by c."id"
      limit 1
    `;
    const group = rows[0];

    if (!group) {
      throw new HttpError(404, 'Group invite not found');
    }

    res.json({
      group: {
        avatarUrl: group.avatarUrl,
        id: group.id,
        memberCount: Number(group.memberCount),
        title: group.title ?? 'Group',
      },
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/quick-reply', async (req, res, next) => {
  try {
    const input = quickReplySchema.parse(req.body);
    const tokenPayload = verifyQuickReplyToken(input.token);
    const currentUserId = tokenPayload.userId;
    const conversationId = tokenPayload.conversationId;

    if (await isAdminBlocked(currentUserId)) {
      throw new HttpError(403, 'This account is blocked');
    }

    const messageInput = createMessageSchema.parse({
      body: input.body,
      kind: 'TEXT',
      metadata: {
        clientId: `quick-reply-${crypto.randomUUID()}`,
      },
    });
    const { serializedMessage } = await createAndBroadcastConversationMessage(req, conversationId, currentUserId, messageInput);
    await markConversationReadForUser(req, conversationId, currentUserId, []);

    res.status(201).json({ message: serializedMessage });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.use(requireAuth);

type EditableMessage = Message & {
  conversation: {
    lastMessageAt: Date | null;
    lastMessageKind: MessageKind | null;
    lastMessageSenderId: string | null;
    members: Array<Pick<ConversationMember, 'aliasName' | 'aliasPromptSeen' | 'userId'>>;
    type: string;
  };
};

type PinnedMessageRow = {
  messageId: string;
  pinnedAt: Date;
  scopeTargetId: string;
};

function dedupePinnedRowsByMessageId(pinRows: PinnedMessageRow[]) {
  const seenMessageIds = new Set<string>();

  return pinRows.filter((pin) => {
    if (seenMessageIds.has(pin.messageId)) {
      return false;
    }

    seenMessageIds.add(pin.messageId);
    return true;
  });
}

function stripConversationContent<T extends { lastMessage?: string; searchSnippet?: string | null }>(conversation: T) {
  return {
    ...conversation,
    lastMessage: '',
    searchSnippet: undefined,
  };
}

conversationRoutes.get('/', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
    const filter = parseConversationListFilter(req.query.filter);
    const limit = clampNumber(parseNumberQuery(req.query.limit), 1, 100, 100);
    const offset = clampNumber(parseNumberQuery(req.query.offset), 0, 100000, 0);
    const metadataOnly = req.query.metadataOnly === 'true';
    const conversationListCacheKey = getConversationListCacheKey(currentUser.id, {
      filter,
      limit,
      metadataOnly,
      offset,
      query,
    });

    if (conversationListCacheKey) {
      const cachedResponse = await cacheGetJson(conversationListCacheKey);

      if (cachedResponse) {
        res.json(cachedResponse);
        return;
      }
    }

    await ensureMeetVapDirectConversationForUser(currentUser.id);
    const unreadConversationIds = filter === 'unread'
      ? (await listUnreadConversationIdsForUser(currentUser.id, query)).slice(offset, offset + limit + 1)
      : undefined;
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: filter === 'unread' ? 0 : offset,
      take: limit + 1,
      where: buildConversationListWhere(currentUser.id, query, filter, unreadConversationIds),
      include: {
        deletions: {
          where: { userId: currentUser.id },
        },
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          include: {
            receipts: {
              select: {
                status: true,
                userId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          where: {
            deletedAt: null,
            deletions: {
              none: { userId: currentUser.id },
            },
            OR: [
              { senderId: currentUser.id },
              {
                contentAcks: {
                  none: { userId: currentUser.id },
                },
                senderId: { not: currentUser.id },
              },
            ],
          },
          take: 1,
        },
      },
    });
    const pagedConversations = conversations.slice(0, limit);
    const visibleConversations = pagedConversations.filter((conversation) => {
      const deletion = conversation.deletions[0];
      const lastMessage = conversation.messages[0];
      const hasOtherDirectMember = conversation.type !== 'DIRECT' || conversation.members.some((member) => member.userId !== currentUser.id);
      const lastActivityAt = lastMessage?.createdAt ?? conversation.lastMessageAt ?? conversation.updatedAt;

      return hasOtherDirectMember && (!deletion || (deletion.mode !== 'BLOCKED_GROUP' && lastActivityAt.getTime() > deletion.deletedAt.getTime()));
    });
    await attachPremiumAccessToConversationMembers(visibleConversations);
    const otherUserIds = visibleConversations.flatMap((conversation) => (
      conversation.members.filter((member) => member.userId !== currentUser.id).map((member) => member.userId)
    ));
    const contacts = otherUserIds.length
      ? await prisma.contact.findMany({
          select: { contactId: true },
          where: {
            contactId: { in: otherUserIds },
            ownerId: currentUser.id,
          },
        })
      : [];
    const contactIds = new Set(contacts.map((contact) => contact.contactId));
    const matchedMessages = query
      ? await prisma.message.findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            body: true,
            conversationId: true,
          },
          where: {
            body: { contains: query, mode: 'insensitive' },
            conversationId: { in: visibleConversations.map((conversation) => conversation.id) },
            deletedAt: null,
            deletions: {
              none: { userId: currentUser.id },
            },
            OR: [
              { senderId: currentUser.id },
              {
                contentAcks: {
                  none: { userId: currentUser.id },
                },
                senderId: { not: currentUser.id },
              },
            ],
          },
        })
      : [];
    const matchedMessageByConversation = new Map(
      matchedMessages.map((message) => [message.conversationId, message.body]),
    );
    const unreadCountByConversationId = await countUnreadMessagesByConversationForUser(
      currentUser.id,
      visibleConversations.map((conversation) => conversation.id),
    );

    const serialized = visibleConversations.map((conversation) => {
      const otherUserId = conversation.members.find((member) => member.userId !== currentUser.id)?.userId;
      const unreadCount = unreadCountByConversationId.get(conversation.id) ?? 0;
      const lowerQuery = query.toLowerCase();
      const nameMatches = query
        ? conversation.members.some((member) => (
            member.userId !== currentUser.id &&
            (
              member.user.displayName.toLowerCase().includes(lowerQuery) ||
              (member.user.hideNickname === false && member.user.username.toLowerCase().includes(lowerQuery))
            )
          ))
        : false;

      return {
        conversation,
        nameMatches,
        result: serializeConversation(
          conversation,
          currentUser.id,
          unreadCount,
          nameMatches ? undefined : matchedMessageByConversation.get(conversation.id),
          {
            isContact: otherUserId ? contactIds.has(otherUserId) : true,
            otherUserId,
          },
        ),
      };
    });

    const ordered = query
      ? serialized.sort((left, right) => Number(right.nameMatches) - Number(left.nameMatches))
      : serialized;

    const totalUnreadConversations = await countUnreadConversationsForUser(currentUser.id);

    const responseBody = {
      conversations: ordered.map((item) => metadataOnly ? stripConversationContent(item.result) : item.result),
      hasMore: filter === 'unread'
        ? (unreadConversationIds?.length ?? 0) > limit
        : conversations.length > limit,
      nextOffset: filter === 'unread'
        ? offset + Math.min(limit, pagedConversations.length)
        : offset + pagedConversations.length,
      totalUnreadConversations,
    };

    if (conversationListCacheKey) {
      await cacheSetJson(conversationListCacheKey, responseBody, CONVERSATION_LIST_CACHE_TTL_SECONDS);
    }

    res.json(responseBody);
  } catch (error) {
    next(error);
  }
});

function parseNumberQuery(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function getConversationListCacheKey(
  userId: string,
  input: {
    filter: string;
    limit: number;
    metadataOnly: boolean;
    offset: number;
    query: string;
  },
) {
  if (
    input.query ||
    input.filter !== 'all' ||
    input.limit !== 100 ||
    input.offset !== 0 ||
    input.metadataOnly
  ) {
    return null;
  }

  return `conversation-list:${userId}:all:100:0`;
}

function getPendingContentAckMessageFilter(userId: string, client: MessageClientIdentity): Prisma.MessageWhereInput {
  if (getMessageClientKind(client) === 'WEB') {
    return {
      messageClientAcks: {
        none: {
          client: 'WEB',
          userId,
        },
      },
    };
  }

  return {
    contentAcks: {
      none: { userId },
    },
  };
}

async function invalidateConversationListCacheForUsers(userIds: string[]) {
  await Promise.all([...new Set(userIds)].filter(Boolean).map((userId) => (
    cacheDeletePattern(`conversation-list:${userId}:*`)
  )));
}

conversationRoutes.post('/direct', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createDirectConversationSchema.parse(req.body);

    if (input.userId === currentUser.id) {
      throw new HttpError(400, 'Cannot create direct conversation with yourself');
    }

    const otherUser = await prisma.user.findUnique({
      where: { id: input.userId },
    });

    if (!otherUser) {
      throw new HttpError(404, 'User not found');
    }

    await assertNotBlockedBetween(currentUser.id, input.userId);

    const existing = await prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { userId: currentUser.id } } },
          { members: { some: { userId: input.userId } } },
        ],
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          where: {
            deletedAt: null,
            deletions: {
              none: { userId: currentUser.id },
            },
          },
          take: 1,
        },
      },
    });

    if (existing) {
      await prisma.conversationDeletion.deleteMany({
        where: {
          conversationId: existing.id,
          userId: currentUser.id,
        },
      });

      const isContact = !!(await prisma.contact.findUnique({
        where: {
          ownerId_contactId: {
            contactId: input.userId,
            ownerId: currentUser.id,
          },
        },
      }));

      await attachPremiumAccessToConversationMembers([existing]);
      res.json({ conversation: serializeConversation(existing, currentUser.id, 0, undefined, { isContact, otherUserId: input.userId }) });
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        members: {
          create: [
            { userId: currentUser.id },
            { userId: input.userId },
          ],
        },
        type: 'DIRECT',
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          where: {
            deletedAt: null,
            deletions: {
              none: { userId: currentUser.id },
            },
          },
          take: 1,
        },
      },
    });

    const isContact = !!(await prisma.contact.findUnique({
      where: {
        ownerId_contactId: {
          contactId: input.userId,
          ownerId: currentUser.id,
        },
      },
    }));

    await attachPremiumAccessToConversationMembers([conversation]);
    res.status(201).json({ conversation: serializeConversation(conversation, currentUser.id, 0, undefined, { isContact, otherUserId: input.userId }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/group', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createGroupConversationSchema.parse(req.body);
    const uniqueUserIds = Array.from(new Set(input.userIds)).filter((userId) => userId !== currentUser.id);
    const meetVapSystemUserId = await getMeetVapSystemUserId();

    if (uniqueUserIds.length === 0) {
      throw new HttpError(400, 'Choose at least one other person');
    }

    if (uniqueUserIds.includes(meetVapSystemUserId)) {
      throw new HttpError(400, 'MeetVap system account cannot be added to groups');
    }

    const users = await prisma.user.findMany({
      select: { id: true },
      where: { id: { in: uniqueUserIds } },
    });

    if (users.length !== uniqueUserIds.length) {
      throw new HttpError(404, 'One or more users were not found');
    }

    await Promise.all(uniqueUserIds.map((userId) => assertNotBlockedBetween(currentUser.id, userId)));

    const conversation = await prisma.conversation.create({
      data: {
        ownerId: currentUser.id,
        title: input.title,
        type: 'GROUP',
        members: {
          create: [
            { userId: currentUser.id, isAdmin: true, aliasPromptSeen: true, lastReadAt: new Date() },
            ...uniqueUserIds.map((userId) => ({ userId })),
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const memberRooms = uniqueUserIds.map((userId) => `user:${userId}`);
    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: conversation.id });

    await attachPremiumAccessToConversationMembers([conversation]);
    res.status(201).json({ conversation: serializeConversation(conversation, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/voice-room', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createGroupConversationSchema.parse(req.body);
    const uniqueUserIds = Array.from(new Set(input.userIds)).filter((userId) => userId !== currentUser.id);
    const meetVapSystemUserId = await getMeetVapSystemUserId();

    if (uniqueUserIds.length === 0) {
      throw new HttpError(400, 'Choose at least one other person');
    }

    if (uniqueUserIds.includes(meetVapSystemUserId)) {
      throw new HttpError(400, 'MeetVap system account cannot be added to voice rooms');
    }

    const users = await prisma.user.findMany({
      select: { id: true },
      where: { id: { in: uniqueUserIds } },
    });

    if (users.length !== uniqueUserIds.length) {
      throw new HttpError(404, 'One or more users were not found');
    }

    await Promise.all(uniqueUserIds.map((userId) => assertNotBlockedBetween(currentUser.id, userId)));

    const conversation = await prisma.conversation.create({
      data: {
        isVoiceRoom: true,
        ownerId: currentUser.id,
        title: input.title,
        type: 'GROUP',
        members: {
          create: [
            { userId: currentUser.id, isAdmin: true, aliasPromptSeen: true, lastReadAt: new Date() },
            ...uniqueUserIds.map((userId) => ({ userId })),
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const memberRooms = uniqueUserIds.map((userId) => `user:${userId}`);
    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: conversation.id });

    await attachPremiumAccessToConversationMembers([conversation]);
    res.status(201).json({ conversation: serializeConversation(conversation, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/voice-room/join', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const conversation = await assertVoiceRoomMember(req.params.conversationId, currentUser.id);
    const roomName = getVoiceRoomLiveKitRoomName(conversation.id);
    const liveKitServer = await selectLiveKitServerForRoom(roomName);

    if (!liveKitServer) {
      throw new HttpError(503, 'Voice rooms are unavailable');
    }

    const participant = await prisma.voiceRoomParticipant.upsert({
      create: {
        conversationId: conversation.id,
        userId: currentUser.id,
        selfMuted: true,
      },
      update: {
        joinedAt: new Date(),
        leftAt: null,
        selfMuted: true,
      },
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: currentUser.id,
        },
      },
    });

    const token = new AccessToken(liveKitServer.apiKey, liveKitServer.apiSecret, {
      identity: currentUser.id,
      name: currentUser.displayName,
      ttl: '12h',
    });

    token.addGrant({
      canPublish: true,
      canSubscribe: true,
      room: roomName,
      roomJoin: true,
    });

    await emitVoiceRoomParticipantsChanged(req, conversation.id);

    res.json({
      participant: serializeVoiceRoomParticipant({
        ...participant,
        user: currentUser,
      }),
      roomName,
      token: await token.toJwt(),
      url: liveKitServer.url,
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/voice-room/leave', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const conversation = await assertVoiceRoomMember(req.params.conversationId, currentUser.id);

    await prisma.voiceRoomParticipant.updateMany({
      data: { leftAt: new Date(), selfMuted: true },
      where: {
        conversationId: conversation.id,
        userId: currentUser.id,
      },
    });

    await emitVoiceRoomParticipantsChanged(req, conversation.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.get('/:conversationId/voice-room/participants', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const conversation = await assertVoiceRoomMember(req.params.conversationId, currentUser.id);
    const limit = clampNumber(parseNumberQuery(req.query.limit), 1, 100, 100);
    const offset = clampNumber(parseNumberQuery(req.query.offset), 0, 100000, 0);
    const participants = await prisma.voiceRoomParticipant.findMany({
      include: {
        user: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
      skip: offset,
      take: limit + 1,
      where: {
        conversationId: conversation.id,
        leftAt: null,
      },
    });

    res.json({
      hasMore: participants.length > limit,
      nextOffset: offset + Math.min(participants.length, limit),
      participants: participants.slice(0, limit).map(serializeVoiceRoomParticipant),
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/voice-room/participants/:userId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateVoiceRoomParticipantSchema.parse(req.body);
    const conversation = await assertVoiceRoomMember(req.params.conversationId, currentUser.id);
    const isTargetSelf = req.params.userId === currentUser.id;

    if (input.selfMuted !== undefined && !isTargetSelf) {
      throw new HttpError(403, 'You can only update your own microphone');
    }

    if (input.adminMuted !== undefined) {
      await assertGroupAdmin(conversation.id, currentUser.id);
    }

    const participant = await prisma.voiceRoomParticipant.update({
      data: {
        ...(input.selfMuted !== undefined ? { selfMuted: input.selfMuted } : {}),
        ...(input.adminMuted !== undefined ? { adminMuted: input.adminMuted } : {}),
      },
      include: {
        user: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: req.params.userId,
        },
      },
    });

    if (participant.leftAt) {
      throw new HttpError(404, 'Voice room participant not found');
    }

    await emitVoiceRoomParticipantsChanged(req, conversation.id);
    res.json({ participant: serializeVoiceRoomParticipant(participant) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/avatar', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateGroupAvatarSchema.parse(req.body);
    await assertGroupAdmin(req.params.conversationId, currentUser.id);
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    const previousAvatarMediaId = getAvatarMediaId(conversation.avatarUrl);
    const nextAvatarMediaId = getAvatarMediaId(input.avatarUrl);

    const updated = await prisma.conversation.update({
      data: { avatarUrl: input.avatarUrl },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });

    await deleteAvatarMediaIfUnused(previousAvatarMediaId, nextAvatarMediaId);

    const memberRooms = updated.members.map((member) => `user:${member.userId}`);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

async function deleteAvatarMediaIfUnused(previousAvatarMediaId: string | null, nextAvatarMediaId: string | null) {
  if (!previousAvatarMediaId || previousAvatarMediaId === nextAvatarMediaId) {
    return;
  }

  const media = await prisma.mediaFile.findUnique({
    select: { id: true, storageKey: true },
    where: { id: previousAvatarMediaId },
  });

  if (!media) {
    return;
  }

  if (await isAvatarMediaReferenced(previousAvatarMediaId)) {
    return;
  }

  await prisma.mediaFile.deleteMany({
    where: {
      id: previousAvatarMediaId,
      messages: { none: {} },
    },
  });

  const filePath = path.resolve(uploadDir, media.storageKey);

  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) {
    return;
  }

  await fs.unlink(filePath).catch(() => undefined);
}

conversationRoutes.patch('/:conversationId/title', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateGroupTitleSchema.parse(req.body);
    await assertGroupAdmin(req.params.conversationId, currentUser.id);
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    const updated = await prisma.conversation.update({
      data: { title: input.title },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });
    const memberRooms = updated.members.map((member) => `user:${member.userId}`);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/settings', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateGroupSettingsSchema.parse(req.body);
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    if (conversation.ownerId !== currentUser.id) {
      throw new HttpError(403, 'Only the group owner can change group settings');
    }

    if (
      input.hideMembers !== undefined ||
      input.ownerOnlyMessages !== undefined ||
      input.showAdmins !== undefined ||
      input.showMemberCount !== undefined
    ) {
      await prisma.conversation.update({
        data: {
          ...(input.hideMembers !== undefined ? { hideMembers: input.hideMembers } : {}),
          ...(input.ownerOnlyMessages !== undefined ? { ownerOnlyMessages: input.ownerOnlyMessages } : {}),
          ...(input.showAdmins !== undefined ? { showAdmins: input.showAdmins } : {}),
          ...(input.showMemberCount !== undefined ? { showMemberCount: input.showMemberCount } : {}),
        },
        where: { id: req.params.conversationId },
      });
    }

    if (input.preventMediaSave !== undefined) {
      await prisma.$executeRaw`
        update "Conversation"
        set "preventMediaSave" = ${input.preventMediaSave}
        where "id" = ${req.params.conversationId}
      `;
    }

    if (input.preventScreenshots === true) {
      await requirePremiumFeatureAccess(currentUser.id);
    }

    if (input.preventScreenshots !== undefined) {
      await prisma.$executeRaw`
        update "Conversation"
        set "preventScreenshots" = ${input.preventScreenshots}
        where "id" = ${req.params.conversationId}
      `;
    }

    if (input.isPublic === true) {
      const inviteCode = await createUniqueGroupInviteCode();

      await prisma.$executeRaw`
        update "Conversation"
        set "isPublic" = true,
            "publicInviteCode" = coalesce("publicInviteCode", ${inviteCode})
        where "id" = ${req.params.conversationId}
      `;
    } else if (input.isPublic === false) {
      await prisma.$executeRaw`
        update "Conversation"
        set "isPublic" = false,
            "publicInviteCode" = null
        where "id" = ${req.params.conversationId}
      `;
    }

    const memberRooms = (await prisma.conversationMember.findMany({
      select: { userId: true },
      where: { conversationId: req.params.conversationId },
    })).map((member) => `user:${member.userId}`);
    const updated = await getConversationForViewer(req.params.conversationId, currentUser.id);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
    res.json({ conversation: updated });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/public-invites/:inviteCode/join', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const inviteCode = String(req.params.inviteCode ?? '').trim();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      select "id"
      from "Conversation"
      where "type" = 'GROUP'::"ConversationType"
        and "isPublic" = true
        and "publicInviteCode" = ${inviteCode}
      limit 1
    `;
    const conversationId = rows[0]?.id;

    if (!conversationId) {
      throw new HttpError(404, 'Group invite not found');
    }

    const canUseGroupAliases = await hasPremiumFeatureAccess(currentUser.id);

    await prisma.conversationMember.upsert({
      create: {
        aliasPromptSeen: !(canUseGroupAliases && currentUser.useGroupAliases === true),
        conversationId,
        userId: currentUser.id,
      },
      update: {},
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUser.id,
        },
      },
    });

    const conversation = await getConversationForViewer(conversationId, currentUser.id);
    req.app.get('io')?.to(`user:${currentUser.id}`).emit('conversation:updated', { conversationId });

    res.json({ conversation });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.get('/:conversationId/screenshot-privacy', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const conversation = await prisma.conversation.findUnique({
      select: {
        members: {
          select: { userId: true },
        },
        ownerId: true,
        type: true,
      },
      where: { id: req.params.conversationId },
    });

    if (!conversation || !conversation.members.some((member) => member.userId === currentUser.id)) {
      throw new HttpError(404, 'Conversation not found');
    }

    if (conversation.type !== 'DIRECT') {
      const groupPrivacyRows = await prisma.$queryRaw<Array<{ ownerId: string | null; preventScreenshots: boolean }>>`
        select "ownerId", "preventScreenshots" from "Conversation" where "id" = ${req.params.conversationId} limit 1
      `;
      const groupPrivacy = groupPrivacyRows[0];
      const ownerHasPremiumAccess = groupPrivacy?.ownerId ? await hasPremiumFeatureAccess(groupPrivacy.ownerId) : false;

      res.json({ preventPeerScreenshots: groupPrivacy?.preventScreenshots === true && ownerHasPremiumAccess });
      return;
    }

    const peer = conversation.members.find((member) => member.userId !== currentUser.id);
    const rows = peer
      ? await prisma.$queryRaw<Array<{ id: string; preventPeerScreenshots: boolean }>>`
          select "id", "preventPeerScreenshots" from "User" where "id" = ${peer.userId} limit 1
        `
      : [];
    const peerPrivacy = rows[0];
    const peerHasPremiumAccess = peerPrivacy?.id ? await hasPremiumFeatureAccess(peerPrivacy.id) : false;

    res.json({ preventPeerScreenshots: peerPrivacy?.preventPeerScreenshots !== false && peerHasPremiumAccess });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/mute', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateConversationMuteSchema.parse(req.body);

    await assertConversationMember(req.params.conversationId, currentUser.id);
    const mutedAt = input.muted ? new Date() : null;
    await prisma.conversationMember.update({
      data: {
        mutedAt,
        mutedUntil: mutedAt && input.durationMinutes
          ? new Date(mutedAt.getTime() + input.durationMinutes * 60 * 1000)
          : null,
      },
      where: {
        conversationId_userId: {
          conversationId: req.params.conversationId,
          userId: currentUser.id,
        },
      },
    });

    const conversation = await getConversationForViewer(req.params.conversationId, currentUser.id);

    req.app.get('io')?.to(`user:${currentUser.id}`).emit('conversation:updated', { conversationId: req.params.conversationId });
    res.json({ conversation });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/disappearing-messages', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateDisappearingMessagesSchema.parse(req.body);
    const conversation = await prisma.conversation.findFirst({
      select: {
        disappearingMessagesSetById: true,
        id: true,
        members: { select: { user: { select: { username: true } }, userId: true } },
        type: true,
      },
      where: {
        id: req.params.conversationId,
        members: { some: { userId: currentUser.id } },
      },
    });

    if (!conversation || conversation.type !== 'DIRECT') {
      throw new HttpError(404, 'Direct conversation not found');
    }

    if (conversation.members.some((member) => member.user.username.toLowerCase() === 'meetvap')) {
      throw new HttpError(403, 'This setting is unavailable for this conversation');
    }

    if (input.durationMinutes === null && conversation.disappearingMessagesSetById !== currentUser.id) {
      throw new HttpError(403, 'Only the user who enabled disappearing messages can disable them');
    }

    await prisma.conversation.update({
      data: {
        disappearingMessagesDurationMinutes: input.durationMinutes,
        disappearingMessagesSetById: input.durationMinutes === null ? null : currentUser.id,
      },
      where: { id: conversation.id },
    });
    await cleanupExpiredDisappearingMessages(req.app.get('io'), conversation.id);

    const memberRooms = conversation.members.map((member) => `user:${member.userId}`);
    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: conversation.id });
    res.json({ conversation: await getConversationForViewer(conversation.id, currentUser.id) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/alias', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateGroupAliasSchema.parse(req.body);

    const conversation = await prisma.conversation.findFirst({
      select: { id: true },
      where: {
        id: req.params.conversationId,
        members: {
          some: { userId: currentUser.id },
        },
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    if (input.aliasName) {
      await requirePremiumFeatureAccess(currentUser.id);
    }

    await prisma.conversationMember.update({
      data: {
        aliasName: input.aliasName,
        aliasPromptSeen: true,
      },
      where: {
        conversationId_userId: {
          conversationId: req.params.conversationId,
          userId: currentUser.id,
        },
      },
    });

    const updated = await getConversationForViewer(req.params.conversationId, currentUser.id);
    const memberRooms = await prisma.conversationMember.findMany({
      select: { userId: true },
      where: { conversationId: req.params.conversationId },
    });

    req.app.get('io')?.to(memberRooms.map((member) => `user:${member.userId}`)).emit('conversation:updated', { conversationId: req.params.conversationId });
    res.json({ conversation: updated });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/invite/decline', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = declineGroupInviteSchema.parse(req.body ?? {});
    const conversation = await prisma.conversation.findFirst({
      select: {
        id: true,
        members: {
          select: { userId: true },
        },
        ownerId: true,
      },
      where: {
        id: req.params.conversationId,
        members: {
          some: { userId: currentUser.id },
        },
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    if (conversation.ownerId === currentUser.id) {
      throw new HttpError(400, 'Group owner cannot decline the group');
    }

    await prisma.$transaction(async (tx) => {
      await tx.conversationMember.delete({
        where: {
          conversationId_userId: {
            conversationId: req.params.conversationId,
            userId: currentUser.id,
          },
        },
      });

      if (input.blockGroup) {
        await tx.conversationDeletion.upsert({
          create: {
            ackedAt: new Date(),
            conversationId: req.params.conversationId,
            deletedAt: new Date(),
            mode: 'BLOCKED_GROUP',
            requestedById: currentUser.id,
            userId: currentUser.id,
          },
          update: {
            ackedAt: new Date(),
            deletedAt: new Date(),
            mode: 'BLOCKED_GROUP',
            requestedById: currentUser.id,
          },
          where: {
            conversationId_userId: {
              conversationId: req.params.conversationId,
              userId: currentUser.id,
            },
          },
        });
      }

      if (input.reportGroup) {
        await tx.report.create({
          data: {
            reason: 'User declined this group invitation and asked MeetVap to review it.',
            reporterId: currentUser.id,
            targetGroupId: req.params.conversationId,
            targetReferenceId: req.params.conversationId,
            targetType: 'GROUP',
          },
        });
      }
    });

    const memberRooms = [
      ...conversation.members.map((member) => `user:${member.userId}`),
      `user:${currentUser.id}`,
    ];

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/members', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateGroupMembersSchema.parse(req.body);
    await assertGroupAdmin(req.params.conversationId, currentUser.id);
    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          select: { userId: true },
        },
      },
      where: {
        id: req.params.conversationId,
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    const existingMemberIds = new Set(conversation.members.map((member) => member.userId));
    const meetVapSystemUserId = await getMeetVapSystemUserId();

    if (input.userIds.includes(meetVapSystemUserId)) {
      throw new HttpError(400, 'MeetVap system account cannot be added to groups');
    }

    const candidateUserIds = Array.from(new Set(input.userIds)).filter((userId) => (
      userId !== currentUser.id && userId !== meetVapSystemUserId && !existingMemberIds.has(userId)
    ));
    const blockedInvites = candidateUserIds.length
      ? await prisma.conversationDeletion.findMany({
          select: { userId: true },
          where: {
            conversationId: req.params.conversationId,
            mode: 'BLOCKED_GROUP',
            userId: { in: candidateUserIds },
          },
        })
      : [];
    const blockedInviteUserIds = new Set(blockedInvites.map((item) => item.userId));
    const uniqueUserIds = candidateUserIds.filter((userId) => !blockedInviteUserIds.has(userId));

    if (uniqueUserIds.length === 0) {
      throw new HttpError(400, 'Choose at least one new subscriber');
    }

    const users = await prisma.user.findMany({
      select: { id: true },
      where: { id: { in: uniqueUserIds } },
    });

    if (users.length !== uniqueUserIds.length) {
      throw new HttpError(404, 'One or more users were not found');
    }

    await Promise.all(uniqueUserIds.map((userId) => assertNotBlockedBetween(currentUser.id, userId)));
    await prisma.conversationDeletion.deleteMany({
      where: {
        conversationId: req.params.conversationId,
        mode: { not: 'BLOCKED_GROUP' },
        userId: { in: uniqueUserIds },
      },
    });

    const updated = await prisma.conversation.update({
      data: {
        members: {
          create: uniqueUserIds.map((userId) => ({ userId })),
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });
    const memberRooms = updated.members.map((member) => `user:${member.userId}`);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId/members/:userId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const isSelfRemoval = req.params.userId === currentUser.id;

    if (!isSelfRemoval) {
      await assertGroupAdmin(req.params.conversationId, currentUser.id);
    }

    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: {
        id: req.params.conversationId,
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    if (req.params.userId === conversation.ownerId) {
      throw new HttpError(400, 'Group owner cannot be removed');
    }

    const membership = conversation.members.find((member) => member.userId === req.params.userId);

    if (!membership) {
      throw new HttpError(404, 'Subscriber not found');
    }

    await prisma.conversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId: req.params.conversationId,
          userId: req.params.userId,
        },
      },
    });

    const updated = await prisma.conversation.findUniqueOrThrow({
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });
    const memberRooms = [
      ...updated.members.map((member) => `user:${member.userId}`),
      `user:${req.params.userId}`,
    ];

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/admins', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateGroupMembersSchema.parse(req.body);
    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          select: { userId: true },
        },
      },
      where: {
        id: req.params.conversationId,
        members: {
          some: { userId: currentUser.id },
        },
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    const existingMemberIds = new Set(conversation.members.map((member) => member.userId));
    const candidateUserIds = Array.from(new Set(input.userIds)).filter((userId) => userId !== currentUser.id);
    const blockedInvites = candidateUserIds.length
      ? await prisma.conversationDeletion.findMany({
          select: { userId: true },
          where: {
            conversationId: req.params.conversationId,
            mode: 'BLOCKED_GROUP',
            userId: { in: candidateUserIds },
          },
        })
      : [];
    const blockedInviteUserIds = new Set(blockedInvites.map((item) => item.userId));
    const uniqueUserIds = candidateUserIds.filter((userId) => !blockedInviteUserIds.has(userId));

    if (uniqueUserIds.length === 0) {
      throw new HttpError(400, 'Choose at least one user');
    }

    const users = await prisma.user.findMany({
      select: { id: true },
      where: { id: { in: uniqueUserIds } },
    });

    if (users.length !== uniqueUserIds.length) {
      throw new HttpError(404, 'One or more users were not found');
    }

    await Promise.all(uniqueUserIds.map((userId) => assertNotBlockedBetween(currentUser.id, userId)));

    await prisma.$transaction(async (tx) => {
      const existingAdminIds = uniqueUserIds.filter((userId) => existingMemberIds.has(userId));
      const newAdminIds = uniqueUserIds.filter((userId) => !existingMemberIds.has(userId));

      if (existingAdminIds.length > 0) {
        await tx.conversationMember.updateMany({
          data: { isAdmin: true },
          where: {
            conversationId: req.params.conversationId,
            userId: { in: existingAdminIds },
          },
        });
      }

      if (newAdminIds.length > 0) {
        await tx.conversationDeletion.deleteMany({
          where: {
            conversationId: req.params.conversationId,
            mode: { not: 'BLOCKED_GROUP' },
            userId: { in: newAdminIds },
          },
        });
        await tx.conversationMember.createMany({
          data: newAdminIds.map((userId) => ({
            conversationId: req.params.conversationId,
            isAdmin: true,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    });

    const updated = await prisma.conversation.findUniqueOrThrow({
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });
    const memberRooms = updated.members.map((member) => `user:${member.userId}`);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId/admins/:userId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: {
        id: req.params.conversationId,
        ownerId: currentUser.id,
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    if (req.params.userId === conversation.ownerId) {
      throw new HttpError(400, 'Group owner admin rights cannot be revoked');
    }

    const currentMembership = conversation.members.find((member) => member.userId === currentUser.id);
    const isOwnerAction = conversation.ownerId === currentUser.id;
    const isSelfAdminLeaveAction = req.params.userId === currentUser.id && currentMembership?.isAdmin === true;

    if (!isOwnerAction && !isSelfAdminLeaveAction) {
      throw new HttpError(403, 'Only the group owner can revoke admin rights');
    }

    const membership = conversation.members.find((member) => member.userId === req.params.userId);

    if (!membership) {
      throw new HttpError(404, 'Subscriber not found');
    }

    if (!membership.isAdmin) {
      throw new HttpError(400, 'Subscriber is not an admin');
    }

    const updated = await prisma.conversation.update({
      data: {
        members: {
          update: {
            data: { isAdmin: false },
            where: {
              conversationId_userId: {
                conversationId: req.params.conversationId,
                userId: req.params.userId,
              },
            },
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });
    const memberRooms = updated.members.map((member) => `user:${member.userId}`);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.patch('/:conversationId/owner', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = transferGroupOwnershipSchema.parse(req.body);
    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          select: {
            isAdmin: true,
            userId: true,
          },
        },
      },
      where: {
        id: req.params.conversationId,
        ownerId: currentUser.id,
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    const targetMember = conversation.members.find((member) => member.userId === input.userId);

    if (!targetMember || (!targetMember.isAdmin && input.userId !== conversation.ownerId)) {
      throw new HttpError(400, 'Choose an existing group admin');
    }

    if (input.userId === currentUser.id) {
      throw new HttpError(400, 'You are already the owner');
    }

    const updated = await prisma.conversation.update({
      data: {
        ownerId: input.userId,
        members: {
          update: {
            data: { isAdmin: true },
            where: {
              conversationId_userId: {
                conversationId: req.params.conversationId,
                userId: input.userId,
              },
            },
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                avatarUrl: true,
                displayName: true,
                hideFromSearch: true,
                hideNickname: true,
                id: true,
                lastSeenAt: true,
                showLastSeen: true,
                username: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: req.params.conversationId },
    });
    const memberRooms = updated.members.map((member) => `user:${member.userId}`);

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: updated.id });
    await attachPremiumAccessToConversationMembers([updated]);
    res.json({ conversation: serializeConversation(updated, currentUser.id, 0, undefined, { isContact: true }) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId/group', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          select: { userId: true },
        },
      },
      where: {
        id: req.params.conversationId,
        ownerId: currentUser.id,
        type: 'GROUP',
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Group not found');
    }

    const memberRooms = conversation.members.map((member) => `user:${member.userId}`);

    await prisma.conversation.delete({
      where: { id: req.params.conversationId },
    });

    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/bulk-delete', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkDeleteConversationsSchema.parse(req.body ?? {});
    const conversationIds = Array.from(new Set(input.conversationIds));
    const conversations = await prisma.conversation.findMany({
      include: {
        members: {
          select: { userId: true },
        },
      },
      where: {
        id: { in: conversationIds },
        members: {
          some: { userId: currentUser.id },
        },
      },
    });
    const meetVapSystemUserId = await getMeetVapSystemUserId();
    const deletionCreatedAt = new Date();
    const deletableConversations = conversations.filter((conversation) => {
      if (conversation.type === 'DIRECT' && conversation.members.some((member) => member.userId === meetVapSystemUserId)) {
        return false;
      }

      return input.mode !== 'all' || conversation.type === 'DIRECT';
    });
    const deletableConversationIds = deletableConversations.map((conversation) => conversation.id);

    if (deletableConversations.length > 0) {
      await prisma.$transaction(deletableConversations.flatMap((conversation) => {
        const targetMembers = input.mode === 'all'
          ? conversation.members
          : conversation.members.filter((member) => member.userId === currentUser.id);

        return targetMembers.map((member) => prisma.conversationDeletion.upsert({
          create: {
            ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
            conversationId: conversation.id,
            deletedAt: deletionCreatedAt,
            mode: input.mode === 'all' ? 'ALL' : 'SELF',
            requestedById: currentUser.id,
            userId: member.userId,
          },
          update: {
            ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
            deletedAt: deletionCreatedAt,
            mode: input.mode === 'all' ? 'ALL' : 'SELF',
            requestedById: currentUser.id,
          },
          where: {
            conversationId_userId: {
              conversationId: conversation.id,
              userId: member.userId,
            },
          },
        }));
      }));

      const messageIds = await prisma.message.findMany({
        select: { id: true },
        where: {
          conversationId: { in: deletableConversationIds },
          deletedAt: null,
        },
      });

      if (messageIds.length > 0) {
        await prisma.messageDeletion.createMany({
          data: messageIds.map((message) => ({
            ackedAt: deletionCreatedAt,
            messageId: message.id,
            mode: 'SELF',
            requestedById: currentUser.id,
            userId: currentUser.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (input.mode === 'all') {
      for (const conversation of deletableConversations) {
        const memberRooms = conversation.members.map((member) => `user:${member.userId}`);

        req.app.get('io')?.to(memberRooms).emit('conversation:deleted', {
          conversationId: conversation.id,
          mode: 'all',
          userId: currentUser.id,
        });
        req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: conversation.id });
      }
    }

    res.json({
      deletedConversationIds: deletableConversationIds,
      ok: true,
      skippedConversationIds: conversationIds.filter((conversationId) => !deletableConversationIds.includes(conversationId)),
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = deleteConversationSchema.parse(req.body ?? {});
    const conversation = await prisma.conversation.findFirst({
      include: {
        members: {
          select: { userId: true },
        },
      },
      where: {
        id: req.params.conversationId,
        members: {
          some: { userId: currentUser.id },
        },
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    const meetVapSystemUserId = await getMeetVapSystemUserId();

    if (conversation.type === 'DIRECT' && conversation.members.some((member) => member.userId === meetVapSystemUserId)) {
      throw new HttpError(400, 'MeetVap chat cannot be deleted');
    }

    if (input.mode === 'all' && conversation.type !== 'DIRECT') {
      throw new HttpError(400, 'Delete for anyone is only available for direct chats');
    }

    const deletionCreatedAt = new Date();
    const targetMembers = input.mode === 'all'
      ? conversation.members
      : conversation.members.filter((member) => member.userId === currentUser.id);

    await Promise.all(targetMembers.map((member) => prisma.conversationDeletion.upsert({
      create: {
        ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
        conversationId: req.params.conversationId,
        deletedAt: deletionCreatedAt,
        mode: input.mode === 'all' ? 'ALL' : 'SELF',
        requestedById: currentUser.id,
        userId: member.userId,
      },
      update: {
        ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
        deletedAt: deletionCreatedAt,
        mode: input.mode === 'all' ? 'ALL' : 'SELF',
        requestedById: currentUser.id,
      },
      where: {
        conversationId_userId: {
          conversationId: req.params.conversationId,
          userId: member.userId,
        },
      },
    })));

    const messageIds = await prisma.message.findMany({
      select: { id: true },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
      },
    });

    if (messageIds.length > 0) {
      await prisma.messageDeletion.createMany({
        data: messageIds.map((message) => ({
          ackedAt: new Date(),
          messageId: message.id,
          mode: 'SELF',
          requestedById: currentUser.id,
          userId: currentUser.id,
        })),
        skipDuplicates: true,
      });
    }

    if (input.mode === 'all') {
      const memberRooms = targetMembers.map((member) => `user:${member.userId}`);

      req.app.get('io')?.to(memberRooms).emit('conversation:deleted', {
        conversationId: req.params.conversationId,
        mode: 'all',
        userId: currentUser.id,
      });
      req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/deletion/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);

    await prisma.conversationDeletion.updateMany({
      data: { ackedAt: new Date() },
      where: {
        ackedAt: null,
        conversationId: req.params.conversationId,
        mode: 'ALL',
        userId: currentUser.id,
      },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.get('/:conversationId/messages', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);
    const after = typeof req.query.after === 'string' ? new Date(req.query.after) : null;
    const afterDate = after && !Number.isNaN(after.getTime()) ? after : null;
    const pendingDeliveryOnly = req.query.pendingDelivery === 'true';
    const pendingContentOnly = req.query.pendingContent === 'true';
    const messageClient = req.messageClient ?? normalizeMessageClient(req.query.client, 'MOBILE');
    const pendingContentFilter = getPendingContentAckMessageFilter(currentUser.id, messageClient);

    const messages = await prisma.message.findMany({
      include: {
        media: true,
        receipts: {
          select: {
            status: true,
            userId: true,
          },
        },
        sender: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 150,
      where: {
        conversationId: req.params.conversationId,
        ...(pendingContentOnly
          ? {
              ...pendingContentFilter,
              contentPurgedAt: null,
            }
          : {}),
        ...(pendingDeliveryOnly
          ? {
              receipts: {
                none: {
                  status: { in: [MessageStatus.DELIVERED, MessageStatus.READ] },
                  userId: currentUser.id,
                },
              },
              senderId: { not: currentUser.id },
            }
          : {}),
        ...(afterDate && !pendingContentOnly
          ? {
              OR: [
                { createdAt: { gt: afterDate } },
                {
                  ...pendingContentFilter,
                  senderId: { not: currentUser.id },
                },
              ],
            }
          : {}),
        ...(!pendingContentOnly
          ? {
              AND: [
                {
                  OR: [
                    { senderId: currentUser.id },
                    {
                      ...pendingContentFilter,
                      senderId: { not: currentUser.id },
                    },
                  ],
                },
              ],
            }
          : {}),
        deletedAt: null,
        deletions: {
          none: { userId: currentUser.id },
        },
      },
    });
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: req.params.conversationId },
    });
    const aliasByUserId = new Map(members.map((member) => [member.userId, member.aliasName]));
    const latestReadMessage = await prisma.message.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        deletions: {
          none: { userId: currentUser.id },
        },
        receipts: {
          some: {
            status: 'READ',
            userId: { not: currentUser.id },
          },
        },
        senderId: currentUser.id,
      },
    });

    res.json({
      messages: messages.map((message) => serializeMessage(
        message,
        getMessageStatusForViewer(message, currentUser.id, members),
        aliasByUserId.get(message.senderId),
      )),
      readThrough: latestReadMessage?.createdAt.toISOString() ?? null,
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.get('/:conversationId/pins', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const pinRows = await prisma.$queryRaw<PinnedMessageRow[]>`
      SELECT "messageId", "pinnedAt", "scopeTargetId"
      FROM "MessagePin"
      WHERE "conversationId" = ${req.params.conversationId}
        AND "scopeTargetId" IN ('ALL', ${currentUser.id})
      ORDER BY "pinnedAt" DESC
    `;
    const visiblePinRows = dedupePinnedRowsByMessageId(pinRows);
    const messageIds = visiblePinRows.map((pin) => pin.messageId);

    if (messageIds.length === 0) {
      res.json({ pins: [] });
      return;
    }

    const messages = await prisma.message.findMany({
      include: {
        media: true,
        receipts: {
          select: {
            status: true,
            userId: true,
          },
        },
        sender: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      where: {
        id: { in: messageIds },
        conversationId: req.params.conversationId,
        deletedAt: null,
        deletions: {
          none: { userId: currentUser.id },
        },
      },
    });
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: req.params.conversationId },
    });
    const aliasByUserId = new Map(members.map((member) => [member.userId, member.aliasName]));
    const messageById = new Map(messages.map((message) => [message.id, message]));

    res.json({
      pins: visiblePinRows
        .map((pin) => {
          const message = messageById.get(pin.messageId);

          if (!message) {
            return null;
          }

          return {
            message: serializeMessage(
              message,
              getMessageStatusForViewer(message, currentUser.id, members),
              aliasByUserId.get(message.senderId),
            ),
            pinnedAt: pin.pinnedAt.toISOString(),
            scope: pin.scopeTargetId === 'ALL' ? 'all' : 'me',
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages/:messageId/pin', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const requestedScope = req.body?.scope === 'all' ? 'all' : 'me';
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const message = await prisma.message.findFirst({
      include: {
        conversation: {
          include: {
            members: true,
          },
        },
        media: true,
        receipts: {
          select: {
            status: true,
            userId: true,
          },
        },
        sender: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      where: {
        id: req.params.messageId,
        conversationId: req.params.conversationId,
        deletedAt: null,
      },
    });

    if (!message) {
      throw new HttpError(404, 'Message not found');
    }

    if (message.conversation.type === 'GROUP') {
      const currentMembership = message.conversation.members.find((member) => member.userId === currentUser.id);

      if (message.conversation.ownerId !== currentUser.id && currentMembership?.isAdmin !== true) {
        throw new HttpError(403, 'Only group admins can pin messages');
      }
    }

    const scope = message.conversation.type === 'GROUP' ? 'all' : requestedScope;
    const scopeTargetId = scope === 'all' ? 'ALL' : currentUser.id;
    const pinnedAt = new Date();
    await prisma.$executeRaw`
      INSERT INTO "MessagePin" ("id", "conversationId", "messageId", "pinnedById", "scopeTargetId", "pinnedAt")
      VALUES (${crypto.randomUUID()}, ${req.params.conversationId}, ${req.params.messageId}, ${currentUser.id}, ${scopeTargetId}, ${pinnedAt})
      ON CONFLICT ("conversationId", "messageId", "scopeTargetId")
      DO UPDATE SET "pinnedById" = EXCLUDED."pinnedById", "pinnedAt" = EXCLUDED."pinnedAt"
    `;

    const aliasByUserId = new Map(message.conversation.members.map((member) => [member.userId, member.aliasName]));
    const serializedMessage = serializeMessage(
      message,
      getMessageStatusForViewer(message, currentUser.id, message.conversation.members),
      aliasByUserId.get(message.senderId),
    );
    const payload = {
      conversationId: req.params.conversationId,
      message: serializedMessage,
      pinnedAt: pinnedAt.toISOString(),
      scope,
    };
    const memberRooms = message.conversation.members
      .filter((member) => (
        scope === 'all'
          ? message.conversation.type !== 'GROUP' || member.userId === currentUser.id || member.aliasPromptSeen === true
          : member.userId === currentUser.id
      ))
      .map((member) => `user:${member.userId}`);

    const io = req.app.get('io');

    if (scope === 'all') {
      io?.to(req.params.conversationId).to(memberRooms).emit('message:pinned', payload);
    } else {
      io?.to(memberRooms).emit('message:pinned', payload);
    }
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId/messages/:messageId/pin', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const scope = req.body?.scope === 'all' ? 'all' : 'me';
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const conversation = await prisma.conversation.findUnique({
      include: { members: true },
      where: { id: req.params.conversationId },
    });

    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    if (conversation.type === 'GROUP') {
      const currentMembership = conversation.members.find((member) => member.userId === currentUser.id);

      if (conversation.ownerId !== currentUser.id && currentMembership?.isAdmin !== true) {
        throw new HttpError(403, 'Only group admins can remove pinned messages');
      }
    }

    const scopeTargetId = conversation.type === 'GROUP' || scope === 'all' ? 'ALL' : currentUser.id;
    await prisma.messagePin.deleteMany({
      where: {
        conversationId: req.params.conversationId,
        messageId: req.params.messageId,
        scopeTargetId,
      },
    });

    const memberRooms = conversation.members
      .filter((member) => (
        scopeTargetId === 'ALL'
          ? conversation.type !== 'GROUP' || member.userId === currentUser.id || member.aliasPromptSeen === true
          : member.userId === currentUser.id
      ))
      .map((member) => `user:${member.userId}`);

    const io = req.app.get('io');
    const payload = {
      conversationId: req.params.conversationId,
      messageId: req.params.messageId,
      scope: scopeTargetId === 'ALL' ? 'all' : 'me',
    };

    if (scopeTargetId === 'ALL') {
      io?.to(req.params.conversationId).to(memberRooms).emit('message:unpinned', payload);
    } else {
      io?.to(memberRooms).emit('message:unpinned', payload);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/read-all', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const messageClient = req.messageClient ?? normalizeMessageClient(req.body?.client, 'MOBILE');
    const readAt = new Date();
    const memberships = await prisma.conversationMember.findMany({
      select: { conversationId: true },
      where: { userId: currentUser.id },
    });
    const conversationIds = memberships.map((membership) => membership.conversationId);

    if (conversationIds.length === 0) {
      res.json({ conversationIds: [], ok: true, readAt: readAt.toISOString() });
      return;
    }

    await prisma.conversationMember.updateMany({
      data: { lastReadAt: readAt },
      where: {
        conversationId: { in: conversationIds },
        userId: currentUser.id,
      },
    });
    const readMessages = await markConversationMessagesReadByUser(conversationIds, currentUser.id, readAt);
    await acknowledgeInlineMessageContent(readMessages.messageIds, currentUser.id, messageClient);
    await purgeAcknowledgedMessageContent(readMessages.messageIds);
    await invalidateConversationListCacheForUsers([currentUser.id]);

    conversationIds.forEach((conversationId) => {
      emitConversationRead(req, conversationId, currentUser.id, readAt);
    });

    res.json({ conversationIds, ok: true, readAt: readAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/read', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);
    const source = req.body && typeof req.body === 'object' && 'source' in req.body && typeof req.body.source === 'string'
      ? req.body.source
      : undefined;
    const requestedMessageIds = req.body && typeof req.body === 'object' && 'messageIds' in req.body && Array.isArray((req.body as { messageIds?: unknown }).messageIds)
      ? (req.body as { messageIds: unknown[] }).messageIds.filter((value): value is string => typeof value === 'string')
      : [];
    const requestedMessageKeys = req.body && typeof req.body === 'object' && 'messageKeys' in req.body && Array.isArray((req.body as { messageKeys?: unknown }).messageKeys)
      ? (req.body as { messageKeys: unknown[] }).messageKeys.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9]{16}$/.test(value))
      : [];

    if (source !== 'chat_open' && source !== 'notification_action') {
      res.json({ ok: true });
      return;
    }

    await markConversationReadForUser(req, req.params.conversationId, currentUser.id, requestedMessageIds, requestedMessageKeys);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/sync/deletions', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkConversationSyncSchema.parse(req.body);
    const conversationIds = await getAcceptedConversationIds(input.conversationIds, currentUser.id);

    if (conversationIds.length === 0) {
      res.json({ items: {} });
      return;
    }

    const [deletions, deleteRequests] = await Promise.all([
      prisma.messageDeletion.findMany({
        select: {
          createdAt: true,
          message: { select: { conversationId: true } },
          messageId: true,
          mode: true,
          requestedById: true,
        },
        where: {
          ackedAt: null,
          message: { conversationId: { in: conversationIds } },
          mode: { in: ['ALL', 'SELF'] },
          userId: currentUser.id,
        },
      }),
      prisma.messageDeleteRequest.findMany({
        select: {
          conversationId: true,
          createdAt: true,
          messageKey: true,
          mode: true,
          requestedById: true,
        },
        where: {
          conversationId: { in: conversationIds },
          mode: 'ALL',
          userId: currentUser.id,
        },
      }),
    ]);
    const items: Record<string, Array<{
      createdAt: string;
      messageId?: string;
      messageKey?: string;
      mode: string;
      requestedById?: string | null;
    }>> = {};

    deletions.forEach((deletion) => {
      const conversationId = deletion.message.conversationId;
      items[conversationId] ??= [];
      items[conversationId].push({
        createdAt: deletion.createdAt.toISOString(),
        messageId: deletion.messageId,
        mode: deletion.mode,
        requestedById: deletion.requestedById,
      });
    });
    deleteRequests.forEach((deletion) => {
      items[deletion.conversationId] ??= [];
      items[deletion.conversationId].push({
        createdAt: deletion.createdAt.toISOString(),
        messageKey: deletion.messageKey,
        mode: deletion.mode,
        requestedById: deletion.requestedById,
      });
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/sync/deletions/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkConversationAckSchema.parse(req.body);
    const conversationIds = await getAcceptedConversationIds(input.items.map((item) => item.conversationId), currentUser.id);
    const acceptedConversationIds = new Set(conversationIds);
    const allDeletedMessageIds: string[] = [];

    await Promise.all(input.items.filter((item) => acceptedConversationIds.has(item.conversationId)).map(async (item) => {
      if (item.messageIds.length > 0) {
        allDeletedMessageIds.push(...item.messageIds);
        await prisma.messageDeletion.updateMany({
          data: { ackedAt: new Date() },
          where: {
            ackedAt: null,
            message: { conversationId: item.conversationId },
            messageId: { in: item.messageIds },
            mode: 'ALL',
            userId: currentUser.id,
          },
        });
      }
      if (item.messageKeys.length > 0) {
        await prisma.messageDeleteRequest.deleteMany({
          where: {
            conversationId: item.conversationId,
            messageKey: { in: item.messageKeys },
            mode: 'ALL',
            userId: currentUser.id,
          },
        });
      }
    }));

    await cleanupFullyAcknowledgedDeletedMessages(allDeletedMessageIds);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/sync/edits', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkConversationSyncSchema.parse(req.body);
    const conversationIds = await getAcceptedConversationIds(input.conversationIds, currentUser.id);

    if (conversationIds.length === 0) {
      res.json({ items: {} });
      return;
    }

    const edits = await prisma.messageEditRequest.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        body: true,
        conversationId: true,
        createdAt: true,
        messageId: true,
        messageKey: true,
        metadata: true,
        requestedById: true,
      },
      where: {
        conversationId: { in: conversationIds },
        userId: currentUser.id,
      },
    });
    const items: Record<string, Array<{
      body: string;
      conversationId: string;
      createdAt: string;
      messageId?: string | null;
      messageKey: string;
      metadata?: Prisma.JsonValue | null;
      requestedById?: string | null;
    }>> = {};

    edits.forEach((edit) => {
      items[edit.conversationId] ??= [];
      items[edit.conversationId].push({
        body: edit.body,
        conversationId: edit.conversationId,
        createdAt: edit.createdAt.toISOString(),
        messageId: edit.messageId,
        messageKey: edit.messageKey,
        metadata: edit.metadata,
        requestedById: edit.requestedById,
      });
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/sync/edits/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkConversationAckSchema.parse(req.body);
    const conversationIds = await getAcceptedConversationIds(input.items.map((item) => item.conversationId), currentUser.id);
    const acceptedConversationIds = new Set(conversationIds);

    await Promise.all(input.items.filter((item) => acceptedConversationIds.has(item.conversationId)).map(async (item) => {
      const editFilters: Prisma.MessageEditRequestWhereInput[] = [];

      if (item.messageIds.length > 0) {
        editFilters.push({ messageId: { in: item.messageIds } });
      }
      if (item.messageKeys.length > 0) {
        editFilters.push({ messageKey: { in: item.messageKeys } });
      }
      if (editFilters.length > 0) {
        await prisma.messageEditRequest.deleteMany({
          where: {
            conversationId: item.conversationId,
            OR: editFilters,
            userId: currentUser.id,
          },
        });
      }
    }));

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/sync/status-updates', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkConversationSyncSchema.parse(req.body);
    const conversationIds = await getAcceptedConversationIds(input.conversationIds, currentUser.id);

    if (conversationIds.length === 0) {
      res.json({ items: {} });
      return;
    }

    const updates = await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.findMany({
      orderBy: { updatedAt: 'asc' },
      select: {
        conversationId: true,
        deliveredAt: true,
        messageId: true,
        messageKey: true,
        readAt: true,
        status: true,
        updatedAt: true,
      },
      where: {
        conversationId: { in: conversationIds },
        OR: [
          { deliveredAckedAt: null, status: 'DELIVERED' },
          { readAckedAt: null, status: 'READ' },
        ],
        userId: currentUser.id,
      },
    }));
    const items: Record<string, Array<{
      conversationId: string;
      deliveredAt?: string | null;
      messageId?: string | null;
      messageKey: string;
      readAt?: string | null;
      status: 'DELIVERED' | 'READ';
      updatedAt: string;
    }>> = {};

    updates.forEach((update) => {
      items[update.conversationId] ??= [];
      items[update.conversationId].push({
        conversationId: update.conversationId,
        deliveredAt: update.deliveredAt?.toISOString() ?? null,
        messageId: update.messageId,
        messageKey: update.messageKey,
        readAt: update.readAt?.toISOString() ?? null,
        status: update.status as 'DELIVERED' | 'READ',
        updatedAt: update.updatedAt.toISOString(),
      });
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/sync/status-updates/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = bulkConversationAckSchema.parse(req.body);
    const conversationIds = await getAcceptedConversationIds(input.items.map((item) => item.conversationId), currentUser.id);
    const acceptedConversationIds = new Set(conversationIds);
    const ackedAt = new Date();

    await Promise.all(input.items.filter((item) => acceptedConversationIds.has(item.conversationId)).map(async (item) => {
      const updateTarget = {
        conversationId: item.conversationId,
        userId: currentUser.id,
        OR: [
          ...(item.messageIds.length > 0 ? [{ messageId: { in: item.messageIds } }] : []),
          ...(item.messageKeys.length > 0 ? [{ messageKey: { in: item.messageKeys } }] : []),
        ],
      };

      await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.updateMany({
        data: {
          deliveredAckedAt: ackedAt,
          readAckedAt: ackedAt,
        },
        where: {
          ...updateTarget,
          status: 'READ',
        },
      }));
      await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.updateMany({
        data: { deliveredAckedAt: ackedAt },
        where: {
          ...updateTarget,
          status: 'DELIVERED',
        },
      }));
    }));

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// TODO-MEETVAP-REMOVE-LEGACY-SYNC-API: compatibility endpoint for app
// versions that predate the bulk /conversations/sync/* APIs.
conversationRoutes.get('/:conversationId/deletions', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const deletions = await prisma.messageDeletion.findMany({
      select: {
        createdAt: true,
        messageId: true,
        mode: true,
        requestedById: true,
      },
      where: {
        ackedAt: null,
        message: { conversationId: req.params.conversationId },
        mode: { in: ['ALL', 'SELF'] },
        userId: currentUser.id,
      },
    });
    const deleteRequests = await prisma.messageDeleteRequest.findMany({
      select: {
        createdAt: true,
        messageKey: true,
        mode: true,
        requestedById: true,
      },
      where: {
        conversationId: req.params.conversationId,
            mode: { in: ['ALL', 'SELF'] },
        userId: currentUser.id,
      },
    });

    res.json({
      deletions: [
        ...deletions.map((deletion) => ({
          createdAt: deletion.createdAt.toISOString(),
          messageId: deletion.messageId,
          mode: deletion.mode,
          requestedById: deletion.requestedById,
        })),
        ...deleteRequests.map((deletion) => ({
          createdAt: deletion.createdAt.toISOString(),
          messageKey: deletion.messageKey,
          mode: deletion.mode,
          requestedById: deletion.requestedById,
        })),
      ],
    });
  } catch (error) {
    next(error);
  }
});

// TODO-MEETVAP-REMOVE-LEGACY-SYNC-API: compatibility endpoint for app
// versions that predate the bulk /conversations/sync/* APIs.
conversationRoutes.get('/:conversationId/edits', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const edits = await prisma.messageEditRequest.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        body: true,
        createdAt: true,
        messageId: true,
        messageKey: true,
        metadata: true,
        requestedById: true,
      },
      where: {
        conversationId: req.params.conversationId,
        userId: currentUser.id,
      },
    });

    res.json({
      edits: edits.map((edit) => ({
        body: edit.body,
        conversationId: req.params.conversationId,
        createdAt: edit.createdAt.toISOString(),
        messageId: edit.messageId,
        messageKey: edit.messageKey,
        metadata: edit.metadata,
        requestedById: edit.requestedById,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// TODO-MEETVAP-REMOVE-LEGACY-SYNC-API: compatibility endpoint for app
// versions that predate the bulk /conversations/sync/* APIs.
conversationRoutes.get('/:conversationId/status-updates', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const updates = await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.findMany({
      orderBy: { updatedAt: 'asc' },
      select: {
        deliveredAt: true,
        messageId: true,
        messageKey: true,
        readAt: true,
        status: true,
        updatedAt: true,
      },
      where: {
        conversationId: req.params.conversationId,
        OR: [
          { deliveredAckedAt: null, status: 'DELIVERED' },
          { readAckedAt: null, status: 'READ' },
        ],
        userId: currentUser.id,
      },
    }));

    res.json({
      updates: updates.map((update) => ({
        conversationId: req.params.conversationId,
        deliveredAt: update.deliveredAt?.toISOString() ?? null,
        messageId: update.messageId,
        messageKey: update.messageKey,
        readAt: update.readAt?.toISOString() ?? null,
        status: update.status,
        updatedAt: update.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// TODO-MEETVAP-REMOVE-LEGACY-SYNC-API: compatibility endpoint for app
// versions that predate the bulk /conversations/sync/* APIs.
conversationRoutes.post('/:conversationId/status-updates/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = messageDeletionAckSchema.parse(req.body);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    if (input.messageIds.length === 0 && input.messageKeys.length === 0) {
      res.json({ ok: true });
      return;
    }

    const updateTarget = {
      conversationId: req.params.conversationId,
      userId: currentUser.id,
      OR: [
        ...(input.messageIds.length > 0 ? [{ messageId: { in: input.messageIds } }] : []),
        ...(input.messageKeys.length > 0 ? [{ messageKey: { in: input.messageKeys } }] : []),
      ],
    };
    const ackedAt = new Date();

    await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.updateMany({
      data: {
        deliveredAckedAt: ackedAt,
        readAckedAt: ackedAt,
      },
      where: {
        ...updateTarget,
        status: 'READ',
      },
    }));
    await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.updateMany({
      data: { deliveredAckedAt: ackedAt },
      where: {
        ...updateTarget,
        status: 'DELIVERED',
      },
    }));

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function markConversationReadForUser(
  req: Request,
  conversationId: string,
  userId: string,
  requestedMessageIds: string[],
  requestedMessageKeys: string[] = [],
) {
  const messageClient = req.messageClient ?? normalizeMessageClient(req.body?.client, 'MOBILE');
  const readAt = new Date();
  await prisma.conversationMember.update({
    data: { lastReadAt: readAt },
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  });
  await prisma.conversationDeletion.deleteMany({
    where: {
      conversationId,
      mode: 'SELF',
      userId,
    },
  });
  const readMessages = await markConversationMessagesReadByUser([conversationId], userId, readAt, requestedMessageIds, requestedMessageKeys);
  await acknowledgeInlineMessageContent(readMessages.messageIds, userId, messageClient);
  await purgeAcknowledgedMessageContent(readMessages.messageIds);
  await invalidateConversationListCacheForUsers([userId]);

  emitConversationRead(req, conversationId, userId, readAt, readMessages.messageIds, readMessages.messageKeys);
}

// TODO-MEETVAP-REMOVE-LEGACY-SYNC-API: compatibility endpoint for app
// versions that predate the bulk /conversations/sync/* APIs.
conversationRoutes.post('/:conversationId/deletions/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = messageDeletionAckSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    if (input.messageIds.length > 0) {
      await prisma.messageDeletion.updateMany({
        data: { ackedAt: new Date() },
        where: {
          ackedAt: null,
          message: { conversationId: req.params.conversationId },
          messageId: { in: input.messageIds },
          mode: { in: ['ALL', 'SELF'] },
          userId: currentUser.id,
        },
      });
      await cleanupFullyAcknowledgedDeletedMessages(input.messageIds);
    }
    if (input.messageKeys.length > 0) {
      await prisma.messageDeleteRequest.deleteMany({
        where: {
          conversationId: req.params.conversationId,
          messageKey: { in: input.messageKeys },
          mode: 'ALL',
          userId: currentUser.id,
        },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// TODO-MEETVAP-REMOVE-LEGACY-SYNC-API: compatibility endpoint for app
// versions that predate the bulk /conversations/sync/* APIs.
conversationRoutes.post('/:conversationId/edits/ack', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = messageDeletionAckSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const editFilters: Prisma.MessageEditRequestWhereInput[] = [];

    if (input.messageIds.length > 0) {
      editFilters.push({ messageId: { in: input.messageIds } });
    }
    if (input.messageKeys.length > 0) {
      editFilters.push({ messageKey: { in: input.messageKeys } });
    }
    if (editFilters.length > 0) {
      await prisma.messageEditRequest.deleteMany({
        where: {
          conversationId: req.params.conversationId,
          OR: editFilters,
          userId: currentUser.id,
        },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages/acks', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = messageIdsSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const messages = await prisma.message.findMany({
      select: { id: true, senderId: true },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        id: { in: input.messageIds },
      },
    });
    const messageIds = messages.map((message) => message.id);
    const incomingMessageIds = messages
      .filter((message) => message.senderId !== currentUser.id)
      .map((message) => message.id);

    if (messageIds.length > 0) {
      const client = req.messageClient ?? normalizeMessageClient(input.client, 'MOBILE');

      await prisma.messageClientAck.createMany({
        data: messageIds.map((messageId) => ({
          client,
          messageId,
          userId: currentUser.id,
        })),
        skipDuplicates: true,
      });

      if (getMessageClientKind(client) === 'MOBILE') {
        await prisma.messageContentAck.createMany({
          data: messageIds.map((messageId) => ({
            messageId,
            userId: currentUser.id,
          })),
          skipDuplicates: true,
        });
      }

      if (incomingMessageIds.length > 0) {
        await markMessagesDeliveredByUser(incomingMessageIds, currentUser.id, new Date());
      }
      await purgeAcknowledgedMessageContent(messageIds);
      const memberRooms = (await prisma.conversationMember.findMany({
        select: { userId: true },
        where: { conversationId: req.params.conversationId },
      })).map((member) => `user:${member.userId}`);

      if (incomingMessageIds.length > 0) {
        req.app.get('io')?.to(memberRooms).emit('message:delivered', {
          conversationId: req.params.conversationId,
          delivererId: currentUser.id,
          messageIds: incomingMessageIds,
        });
      }
      req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages/delivered', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = messageIdsSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const messages = await prisma.message.findMany({
      select: { id: true },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        id: { in: input.messageIds },
        senderId: { not: currentUser.id },
      },
    });
    const messageIds = messages.map((message) => message.id);

    if (messageIds.length > 0) {
      await markMessagesDeliveredByUser(messageIds, currentUser.id, new Date());
      const memberRooms = (await prisma.conversationMember.findMany({
        select: { userId: true },
        where: { conversationId: req.params.conversationId },
      })).map((member) => `user:${member.userId}`);

      req.app.get('io')?.to(memberRooms).emit('message:delivered', {
        conversationId: req.params.conversationId,
        delivererId: currentUser.id,
        messageIds,
      });
      req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createMessageSchema.parse(req.body);
    const { serializedMessage } = await createAndBroadcastConversationMessage(req, req.params.conversationId, currentUser.id, input);

    res.status(201).json({ message: serializedMessage });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.get('/:conversationId/scheduled-messages', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const messages = await prisma.scheduledMessage.findMany({
      orderBy: [{ sendAt: 'asc' }, { createdAt: 'asc' }],
      where: {
        conversationId: req.params.conversationId,
        senderId: currentUser.id,
        status: 'PENDING',
      },
    });

    res.json({ scheduledMessages: messages.map(serializeScheduledMessage) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/scheduled-messages', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createScheduledMessageSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);
    await assertNoConversationBlocks(req.params.conversationId, currentUser.id);
    await assertCanSendConversationMessage(req.params.conversationId, currentUser.id);

    if (input.mediaId) {
      await assertMessageMediaAvailable(input.mediaId, currentUser.id);
    }

    const scheduledMessage = await prisma.scheduledMessage.create({
      data: {
        body: input.body,
        clientTimezone: input.clientTimezone,
        conversationId: req.params.conversationId,
        kind: input.kind,
        mediaId: input.mediaId,
        metadata: ensureMessageDeleteKey(input.metadata) as Prisma.InputJsonValue,
        sendAt: new Date(input.sendAt),
        senderId: currentUser.id,
      },
    });

    res.status(201).json({ scheduledMessage: serializeScheduledMessage(scheduledMessage) });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId/scheduled-messages/:scheduledMessageId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await assertConversationMember(req.params.conversationId, currentUser.id);

    const result = await prisma.scheduledMessage.updateMany({
      data: {
        cancelledAt: new Date(),
        status: 'CANCELLED',
      },
      where: {
        conversationId: req.params.conversationId,
        id: req.params.scheduledMessageId,
        senderId: currentUser.id,
        status: 'PENDING',
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, 'Scheduled message not found');
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages/:messageId/disappearing/open', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = openDisappearingMessageSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);

    const message = await prisma.message.findFirst({
      select: {
        conversationId: true,
        id: true,
        metadata: true,
        senderId: true,
      },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        id: req.params.messageId,
      },
    });

    if (!message) {
      throw new HttpError(404, 'Message not found');
    }

    if (message.senderId === currentUser.id) {
      throw new HttpError(400, 'Sender copy does not expire after viewing');
    }

    const secondsAfterView = input.secondsAfterView ?? getDisappearingSecondsAfterView(message.metadata);

    if (!secondsAfterView) {
      throw new HttpError(400, 'Message is not configured to disappear after viewing');
    }

    const openedAt = new Date();
    const deleteAt = new Date(openedAt.getTime() + secondsAfterView * 1000);
    const view = await prisma.disappearingMessageView.upsert({
      create: {
        conversationId: req.params.conversationId,
        deleteAt,
        messageId: message.id,
        openedAt,
        secondsAfterView,
        senderId: message.senderId,
        viewerId: currentUser.id,
      },
      update: {},
      where: {
        messageId_viewerId: {
          messageId: message.id,
          viewerId: currentUser.id,
        },
      },
    });

    res.json({
      disappearingView: {
        deleteAt: view.deleteAt.toISOString(),
        messageId: view.messageId,
        openedAt: view.openedAt.toISOString(),
        secondsAfterView: view.secondsAfterView,
      },
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages/:messageId/reaction', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = messageReactionSchema.parse(req.body);

    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertGroupInviteAccepted(req.params.conversationId, currentUser.id);
    await assertNoConversationBlocks(req.params.conversationId, currentUser.id);

    const updatedMessage = await prisma.$transaction(async (tx) => {
      const message = await tx.message.findFirst({
        include: {
          conversation: {
            include: {
              members: {
                select: {
                  aliasName: true,
                  aliasPromptSeen: true,
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
              showLastSeen: true,
              username: true,
            },
          },
        },
        where: {
          conversationId: req.params.conversationId,
          deletedAt: null,
          id: req.params.messageId,
        },
      });

      if (!message) {
        throw new HttpError(404, 'Message not found');
      }

      const metadata = getMessageMetadataObject(message.metadata);
      const reactions = getReactionMetadata(metadata);

      if (input.emoji) {
        reactions[currentUser.id] = input.emoji;
      } else {
        delete reactions[currentUser.id];
      }

      const nextMetadata = {
        ...metadata,
        reactions,
      };

      return tx.message.update({
        data: { metadata: nextMetadata as Prisma.InputJsonValue },
        include: {
          conversation: {
            include: {
              members: {
                select: {
                  aliasName: true,
                  aliasPromptSeen: true,
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
              showLastSeen: true,
              username: true,
            },
          },
        },
        where: { id: message.id },
      });
    });

    const io = req.app.get('io');
    const memberRooms = updatedMessage.conversation.members
      .filter((member) => updatedMessage.conversation.type !== 'GROUP' || member.userId === currentUser.id || member.aliasPromptSeen === true)
      .map((member) => `user:${member.userId}`);
    const reaction = {
      conversationId: req.params.conversationId,
      emoji: input.emoji,
      messageId: updatedMessage.id,
      reactions: getReactionMetadata(getMessageMetadataObject(updatedMessage.metadata)),
      userId: currentUser.id,
    };
    const senderAliasName = updatedMessage.conversation.members.find((member) => member.userId === updatedMessage.senderId)?.aliasName;

    await invalidateConversationListCacheForUsers(updatedMessage.conversation.members.map((member) => member.userId));
    io?.to(req.params.conversationId).to(memberRooms).emit('message:reaction', reaction);

    if (input.emoji) {
      await createReactionFallbackMessage(req, {
        conversationId: req.params.conversationId,
        emoji: input.emoji,
        memberRooms,
        messageId: updatedMessage.id,
        senderAliasName,
        userId: currentUser.id,
      });
    }

    res.json({
      message: serializeMessage(updatedMessage, undefined, senderAliasName),
      reaction,
    });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.post('/:conversationId/messages/:messageId/edit', editConversationMessage);
conversationRoutes.patch('/:conversationId/messages/:messageId', editConversationMessage);

export async function createAndBroadcastConversationMessage(
  req: Request,
  conversationId: string,
  currentUserId: string,
  input: CreateConversationMessageInput,
) {
  await enforceRateLimit(
    currentUserId,
    input.kind === 'TEXT' ? 'text-message' : 'media-message',
    input.kind === 'TEXT'
      ? operationalConfig.rateLimits.textMessagesPerMinute
      : operationalConfig.rateLimits.mediaMessagesPerMinute,
  );
  await assertConversationMember(conversationId, currentUserId);
  await assertGroupInviteAccepted(conversationId, currentUserId);
  await assertNoConversationBlocks(conversationId, currentUserId);
  await assertCanSendConversationMessage(conversationId, currentUserId);
  const media = input.mediaId
    ? await assertMessageMediaAvailable(input.mediaId, currentUserId)
    : undefined;
  const metadata = ensureMessageDeleteKey(input.metadata);
  const sentAt = new Date();
  const requestMessageClient = req.messageClient ?? normalizeMessageClient(req.body?.client, 'MOBILE');

  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        body: input.body,
        conversationId,
        createdAt: sentAt,
        kind: input.kind,
        mediaId: media?.id,
        metadata: metadata as Prisma.InputJsonValue,
        senderId: currentUserId,
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
            showLastSeen: true,
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
          userId: currentUserId,
        },
      },
    });
    await tx.messageClientAck.create({
      data: {
        client: requestMessageClient,
        messageId: createdMessage.id,
        userId: currentUserId,
      },
    });
    if (getMessageClientKind(requestMessageClient) === 'MOBILE') {
      await tx.messageContentAck.create({
        data: {
          messageId: createdMessage.id,
          userId: currentUserId,
        },
      });
    }
    await tx.conversationDeletion.deleteMany({
      where: {
        conversationId,
        deletedAt: { lte: sentAt },
      },
    });
    await recordMessageStats(tx, {
      kind: input.kind,
      mediaSizeBytes: media?.sizeBytes,
      senderId: currentUserId,
    });

    return createdMessage;
  });

  const io = req.app.get('io');
  const memberRooms = message.conversation.members
    .filter((member) => message.conversation.type !== 'GROUP' || member.userId === currentUserId || member.aliasPromptSeen === true)
    .map((member) => `user:${member.userId}`);
  const senderAliasName = message.conversation.members.find((member) => member.userId === currentUserId)?.aliasName;
  const serializedMessage = serializeMessage(message, undefined, senderAliasName);
  await invalidateConversationListCacheForUsers(message.conversation.members.map((member) => member.userId));

  io?.to(conversationId).to(memberRooms).emit('message:new', serializedMessage);
  io?.to(memberRooms).emit('conversation:updated', { conversationId });
  void sendMessageNotification({
    avatarUrl: getMessageAvatarUrl(message),
    body: getPushBodyForMessage(message),
    conversationId,
    messageId: message.id,
    senderId: currentUserId,
    title: senderAliasName || message.sender.displayName || message.sender.username,
  }).catch((error) => {
    console.warn('Could not send message push notification', error);
  });
  if (message.conversation.type === 'DIRECT') {
    void getMeetVapSystemUserId()
      .then((supportUserId) => {
        if (
          currentUserId === supportUserId ||
          !message.conversation.members.some((member) => member.userId === supportUserId)
        ) {
          return false;
        }

        return notifyServerSupportTicketCreated({
          io,
          messageId: message.id,
          user: {
            displayName: message.sender.displayName,
            id: message.sender.id,
            username: message.sender.username,
          },
        });
      })
      .catch((error) => {
        console.warn('Could not send support ticket server event', error);
      });
  }

  return { message, serializedMessage };
}

function verifyQuickReplyToken(token: string) {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload & {
      conversationId?: unknown;
      purpose?: unknown;
    };

    if (
      payload.purpose !== 'quick-reply' ||
      typeof payload.conversationId !== 'string' ||
      typeof payload.sub !== 'string'
    ) {
      throw new HttpError(401, 'Invalid quick reply token');
    }

    return {
      conversationId: payload.conversationId,
      userId: payload.sub,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(401, 'Invalid quick reply token');
  }
}

async function editConversationMessage(
  req: Request<{ conversationId: string; messageId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const currentUser = getAuthedUser(req);
    const input = editMessageSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    await assertNoConversationBlocks(req.params.conversationId, currentUser.id);
    const editedAt = new Date();
    const message = await prisma.message.findFirst({
      include: {
        conversation: {
          select: {
            lastMessageAt: true,
            lastMessageKind: true,
            lastMessageSenderId: true,
            members: {
              select: {
                aliasName: true,
                aliasPromptSeen: true,
                userId: true,
              },
            },
            type: true,
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
            username: true,
          },
        },
      },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        id: req.params.messageId,
      },
    }) as EditableMessage | null;

    if (!message) {
      if (!input.messageKey) {
        throw new HttpError(404, 'Message not found');
      }

      const metadata = {
        deleteKey: input.messageKey,
        editedAt: editedAt.toISOString(),
      };
      const recipients = await queueMessageEditRequest({
        body: input.body,
        conversationId: req.params.conversationId,
        messageId: req.params.messageId,
        messageKey: input.messageKey,
        metadata,
        requestedById: currentUser.id,
      });
      const editPayload = {
        body: input.body,
        conversationId: req.params.conversationId,
        createdAt: input.createdAt,
        messageId: req.params.messageId,
        messageKey: input.messageKey,
        metadata,
        requestedById: currentUser.id,
        updatedAt: editedAt.toISOString(),
      };

      await updateConversationPreviewForMissingEdit(req.params.conversationId, currentUser.id, input.body, input.createdAt);
      req.app.get('io')?.to(recipients.map((recipient) => `user:${recipient.userId}`)).emit('message:edited', editPayload);
      req.app.get('io')?.to(recipients.map((recipient) => `user:${recipient.userId}`)).emit('conversation:updated', { conversationId: req.params.conversationId });

      res.json({ edit: editPayload });
      return;
    }

    if (message.senderId !== currentUser.id) {
      throw new HttpError(403, 'Only the sender can edit this message');
    }

    if (message.kind !== 'TEXT' || message.mediaId) {
      throw new HttpError(400, 'Only text messages can be edited');
    }

    const messageKey = input.messageKey ?? getMessageDeleteKey(message) ?? createMessageDeleteKey();
    const metadata = {
      ...getMessageMetadataObject(message.metadata),
      deleteKey: messageKey,
      editedAt: editedAt.toISOString(),
    };
    const isConversationPreviewMessage = message.conversation.lastMessageKind === message.kind &&
      message.conversation.lastMessageSenderId === message.senderId &&
      message.conversation.lastMessageAt?.getTime() === message.createdAt.getTime();
    const updatedMessage = await prisma.$transaction(async (tx) => {
      const nextMessage = await tx.message.update({
        data: {
          body: input.body,
          metadata: metadata as Prisma.InputJsonValue,
        },
        include: {
          media: true,
          sender: {
            select: {
              avatarUrl: true,
              displayName: true,
              hideFromSearch: true,
              hideNickname: true,
              id: true,
              username: true,
            },
          },
        },
        where: { id: message.id },
      });

      if (isConversationPreviewMessage) {
        await tx.conversation.update({
          data: { lastMessageBody: input.body },
          where: { id: req.params.conversationId },
        });
      }
      await tx.messageContentAck.deleteMany({
        where: {
          messageId: message.id,
          userId: { not: currentUser.id },
        },
      });

      return nextMessage;
    });
    const io = req.app.get('io');
    const memberRooms = message.conversation.members
      .filter((member) => message.conversation.type !== 'GROUP' || member.userId === currentUser.id || member.aliasPromptSeen === true)
      .map((member) => `user:${member.userId}`);
    const recipients = await queueMessageEditRequest({
      body: input.body,
      conversationId: req.params.conversationId,
      messageId: message.id,
      messageKey,
      metadata,
      requestedById: currentUser.id,
    });
    const editPayload = {
      body: input.body,
      conversationId: req.params.conversationId,
      createdAt: message.createdAt.toISOString(),
      messageId: message.id,
      messageKey,
      metadata,
      requestedById: currentUser.id,
      updatedAt: updatedMessage.updatedAt.toISOString(),
    };

    io?.to(req.params.conversationId).to(memberRooms).to(recipients.map((recipient) => `user:${recipient.userId}`)).emit('message:edited', editPayload);
    io?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });

    res.json({ edit: editPayload });
  } catch (error) {
    next(error);
  }
}

conversationRoutes.delete('/:conversationId/call-messages/:callId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = deleteMessageSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    const message = await prisma.message.findFirst({
      select: { id: true, metadata: true },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        kind: 'CALL',
        metadata: {
          path: ['callId'],
          equals: req.params.callId,
        },
      },
    });

    if (!message) {
      if (input.mode === 'all' && input.messageKey) {
        const recipients = await queueMessageDeleteRequest({
          conversationId: req.params.conversationId,
          deleteKey: input.messageKey,
          requestedById: currentUser.id,
        });
        const memberRooms = recipients.map((member) => `user:${member.userId}`);

        req.app.get('io')?.to(memberRooms).emit('message:deleted', {
          conversationId: req.params.conversationId,
          messageKey: input.messageKey,
          mode: 'all',
          userId: currentUser.id,
        });
      }
      res.json({ ok: true });
      return;
    }

    const io = req.app.get('io');

    if (input.mode === 'all') {
      await prisma.message.update({
        data: { body: '', contentPurgedAt: new Date(), deletedAt: new Date(), mediaId: null },
        where: { id: message.id },
      });
      await prisma.messagePin.deleteMany({
        where: {
          conversationId: req.params.conversationId,
          messageId: message.id,
        },
      });
      await refreshConversationPreview(req.params.conversationId);

      const members = await prisma.conversationMember.findMany({
        select: { userId: true },
        where: { conversationId: req.params.conversationId },
      });
      const memberRooms = members.map((member) => `user:${member.userId}`);
      const deletionCreatedAt = new Date();
      const deleteKey = input.messageKey ?? getMessageDeleteKey(message);

      await Promise.all(members.map((member) => prisma.messageDeletion.upsert({
        create: {
          ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
          createdAt: deletionCreatedAt,
          messageId: message.id,
          mode: 'ALL',
          requestedById: currentUser.id,
          userId: member.userId,
        },
        update: {
          ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
          createdAt: deletionCreatedAt,
          mode: 'ALL',
          requestedById: currentUser.id,
        },
        where: {
          messageId_userId: {
            messageId: message.id,
            userId: member.userId,
          },
        },
      })));
      if (deleteKey) {
        await queueMessageDeleteRequest({
          conversationId: req.params.conversationId,
          deleteKey,
          requestedById: currentUser.id,
        });
      }

      io?.to(req.params.conversationId).to(memberRooms).emit('message:deleted', {
        conversationId: req.params.conversationId,
        messageId: message.id,
        ...(deleteKey ? { messageKey: deleteKey } : {}),
        mode: 'all',
        userId: currentUser.id,
      });
      io?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
      await cleanupFullyAcknowledgedDeletedMessages([message.id]);
    } else {
      await prisma.messagePin.deleteMany({
        where: {
          conversationId: req.params.conversationId,
          messageId: message.id,
          scopeTargetId: currentUser.id,
        },
      });
      await prisma.messageDeletion.createMany({
        data: [{
          ackedAt: new Date(),
          messageId: message.id,
          mode: 'SELF',
          requestedById: currentUser.id,
          userId: currentUser.id,
        }],
        skipDuplicates: true,
      });

      io?.to(`user:${currentUser.id}`).emit('message:deleted', {
        conversationId: req.params.conversationId,
        messageId: message.id,
        mode: 'me',
        userId: currentUser.id,
      });
      io?.to(`user:${currentUser.id}`).emit('conversation:updated', { conversationId: req.params.conversationId });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

conversationRoutes.delete('/:conversationId/messages/:messageId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = deleteMessageSchema.parse(req.body);
    await assertConversationMember(req.params.conversationId, currentUser.id);
    const message = await prisma.message.findFirst({
      select: { id: true, metadata: true },
      where: {
        conversationId: req.params.conversationId,
        deletedAt: null,
        OR: [
          { id: req.params.messageId },
          ...(input.messageKey
            ? [{
                metadata: {
                  path: ['deleteKey'],
                  equals: input.messageKey,
                },
              }]
            : []),
        ],
      },
    });

    if (!message) {
      if (input.mode === 'all' && input.messageKey) {
        const recipients = await queueMessageDeleteRequest({
          conversationId: req.params.conversationId,
          deleteKey: input.messageKey,
          requestedById: currentUser.id,
        });
        const memberRooms = recipients.map((member) => `user:${member.userId}`);

        req.app.get('io')?.to(memberRooms).emit('message:deleted', {
          conversationId: req.params.conversationId,
          messageKey: input.messageKey,
          mode: 'all',
          userId: currentUser.id,
        });
        res.json({ ok: true });
        return;
      }

      if (input.mode === 'me' && input.messageKey) {
        res.json({ ok: true });
        return;
      }

      throw new HttpError(404, 'Message not found');
    }

    const io = req.app.get('io');

    if (input.mode === 'all') {
      await deleteMessageMediaFiles([message.id]);
      await prisma.message.update({
        data: { body: '', contentPurgedAt: new Date(), deletedAt: new Date(), mediaId: null },
        where: { id: message.id },
      });
      await prisma.messagePin.deleteMany({
        where: {
          conversationId: req.params.conversationId,
          messageId: message.id,
        },
      });
      await refreshConversationPreview(req.params.conversationId);

      const members = await prisma.conversationMember.findMany({
        select: { userId: true },
        where: { conversationId: req.params.conversationId },
      });
      const memberRooms = members.map((member) => `user:${member.userId}`);
      const deletionCreatedAt = new Date();
      const deleteKey = input.messageKey ?? getMessageDeleteKey(message);

      await Promise.all(members.map((member) => prisma.messageDeletion.upsert({
        create: {
          ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
          createdAt: deletionCreatedAt,
          messageId: message.id,
          mode: 'ALL',
          requestedById: currentUser.id,
          userId: member.userId,
        },
        update: {
          ackedAt: member.userId === currentUser.id ? deletionCreatedAt : null,
          createdAt: deletionCreatedAt,
          mode: 'ALL',
          requestedById: currentUser.id,
        },
        where: {
          messageId_userId: {
            messageId: message.id,
            userId: member.userId,
          },
        },
      })));
      if (deleteKey) {
        await queueMessageDeleteRequest({
          conversationId: req.params.conversationId,
          deleteKey,
          requestedById: currentUser.id,
        });
      }

      io?.to(req.params.conversationId).to(memberRooms).emit('message:deleted', {
        conversationId: req.params.conversationId,
        messageId: message.id,
        ...(deleteKey ? { messageKey: deleteKey } : {}),
        mode: 'all',
        userId: currentUser.id,
      });
      io?.to(memberRooms).emit('conversation:updated', { conversationId: req.params.conversationId });
      await cleanupFullyAcknowledgedDeletedMessages([message.id]);
    } else {
      await prisma.messagePin.deleteMany({
        where: {
          conversationId: req.params.conversationId,
          messageId: message.id,
          scopeTargetId: currentUser.id,
        },
      });
      await prisma.messageDeletion.createMany({
        data: [{
          ackedAt: new Date(),
          messageId: message.id,
          mode: 'SELF',
          requestedById: currentUser.id,
          userId: currentUser.id,
        }],
        skipDuplicates: true,
      });

      io?.to(`user:${currentUser.id}`).emit('message:deleted', {
        conversationId: req.params.conversationId,
        messageId: message.id,
        mode: 'me',
        userId: currentUser.id,
      });
      io?.to(`user:${currentUser.id}`).emit('conversation:updated', { conversationId: req.params.conversationId });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function assertConversationMember(conversationId: string, userId: string) {
  const member = await withTransientDatabaseRetry(() => prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  }));

  if (!member) {
    throw new HttpError(404, 'Conversation not found');
  }
}

async function getAcceptedConversationIds(conversationIds: string[], userId: string) {
  const uniqueConversationIds = uniqueStrings(conversationIds);

  if (uniqueConversationIds.length === 0) {
    return [];
  }

  const memberships = await withTransientDatabaseRetry(() => prisma.conversationMember.findMany({
    select: {
      aliasPromptSeen: true,
      conversation: {
        select: {
          ownerId: true,
          type: true,
        },
      },
      conversationId: true,
    },
    where: {
      conversationId: { in: uniqueConversationIds },
      userId,
    },
  }));

  return memberships
    .filter((membership) => (
      membership.conversation.type !== 'GROUP' ||
      membership.conversation.ownerId === userId ||
      membership.aliasPromptSeen === true
    ))
    .map((membership) => membership.conversationId);
}

async function assertGroupInviteAccepted(conversationId: string, userId: string) {
  const membership = await withTransientDatabaseRetry(() => prisma.conversationMember.findUnique({
    select: {
      aliasPromptSeen: true,
      conversation: {
        select: {
          ownerId: true,
          type: true,
        },
      },
    },
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  }));

  if (!membership) {
    throw new HttpError(404, 'Conversation not found');
  }

  if (membership.conversation.type === 'GROUP' && membership.conversation.ownerId !== userId && membership.aliasPromptSeen === false) {
    throw new HttpError(403, 'Accept the group invite first');
  }
}

async function assertVoiceRoomMember(conversationId: string, userId: string) {
  const membership = await prisma.conversationMember.findUnique({
    select: {
      aliasPromptSeen: true,
      conversation: {
        select: {
          id: true,
          isVoiceRoom: true,
          ownerId: true,
          type: true,
        },
      },
    },
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  });

  if (!membership || membership.conversation.type !== 'GROUP' || membership.conversation.isVoiceRoom !== true) {
    throw new HttpError(404, 'Voice room not found');
  }

  if (membership.conversation.ownerId !== userId && membership.aliasPromptSeen === false) {
    throw new HttpError(403, 'Accept the group invite first');
  }

  return membership.conversation;
}

function getVoiceRoomLiveKitRoomName(conversationId: string) {
  return `voice-room-${conversationId}`;
}

function serializeVoiceRoomParticipant(participant: {
  adminMuted: boolean;
  joinedAt: Date;
  leftAt: Date | null;
  selfMuted: boolean;
  user: {
    avatarUrl?: string | null;
    displayName?: string | null;
    hideFromSearch?: boolean;
    hideNickname?: boolean;
    id: string;
    lastSeenAt?: Date | null;
    showLastSeen?: boolean;
    username: string;
  };
  userId: string;
}) {
  return {
    adminMuted: participant.adminMuted,
    isConnected: participant.leftAt === null,
    joinedAt: participant.joinedAt.toISOString(),
    selfMuted: participant.selfMuted,
    user: {
      avatarUrl: participant.user.avatarUrl,
      displayName: participant.user.displayName,
      hideFromSearch: participant.user.hideFromSearch,
      hideNickname: participant.user.hideNickname,
      id: participant.user.id,
      lastSeenAt: participant.user.lastSeenAt?.toISOString() ?? null,
      showLastSeen: participant.user.showLastSeen,
      username: participant.user.username,
    },
    userId: participant.userId,
  };
}

async function emitVoiceRoomParticipantsChanged(req: Request, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    select: {
      members: {
        select: { userId: true },
      },
    },
    where: { id: conversationId },
  });
  const memberRooms = conversation?.members.map((member) => `user:${member.userId}`) ?? [];

  req.app.get('io')?.to(conversationId).to(memberRooms).emit('voice-room:participants', { conversationId });
}

async function assertGroupAdmin(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    include: {
      members: {
        select: {
          isAdmin: true,
          userId: true,
        },
      },
    },
    where: {
      id: conversationId,
      type: 'GROUP',
    },
  });

  if (!conversation) {
    throw new HttpError(404, 'Group not found');
  }

  const membership = conversation.members.find((member) => member.userId === userId);

  if (!membership || (conversation.ownerId !== userId && !membership.isAdmin)) {
    throw new HttpError(403, 'Only group admins can do this');
  }
}

async function getConversationForViewer(conversationId: string, currentUserId: string) {
  const conversation = await prisma.conversation.findFirst({
    include: {
      members: {
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
              hideFromSearch: true,
              hideNickname: true,
              id: true,
              lastSeenAt: true,
              showLastSeen: true,
              username: true,
            },
          },
        },
      },
      messages: {
        include: {
          receipts: {
            select: {
              status: true,
              userId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        where: {
          deletedAt: null,
          deletions: {
            none: { userId: currentUserId },
          },
          OR: [
            { senderId: currentUserId },
            {
              contentAcks: {
                none: { userId: currentUserId },
              },
              senderId: { not: currentUserId },
            },
          ],
        },
        take: 1,
      },
    },
    where: {
      id: conversationId,
      members: {
        some: { userId: currentUserId },
      },
    },
  });

  if (!conversation) {
    throw new HttpError(404, 'Conversation not found');
  }

  await attachPremiumAccessToConversationMembers([conversation]);

  const membership = conversation.members.find((member) => member.userId === currentUserId);
  const otherUserId = conversation.members.find((member) => member.userId !== currentUserId)?.userId;
  const unreadCount = await prisma.message.count({
    where: {
      conversationId,
      createdAt: membership?.lastReadAt ? { gt: membership.lastReadAt } : undefined,
      deletedAt: null,
      deletions: {
        none: { userId: currentUserId },
      },
      contentAcks: {
        none: { userId: currentUserId },
      },
      OR: [
        { kind: { not: 'CALL' } },
        {
          kind: 'CALL',
          OR: [
            {
              metadata: {
                path: ['callStatus'],
                equals: 'MISSED',
              },
            },
            {
              metadata: {
                path: ['callStatus'],
                equals: 'CANCELLED',
              },
            },
          ],
        },
      ],
      senderId: { not: currentUserId },
    },
  });
  const isContact = otherUserId
    ? !!(await prisma.contact.findUnique({
        where: {
          ownerId_contactId: {
            contactId: otherUserId,
            ownerId: currentUserId,
          },
        },
      }))
    : true;

  return serializeConversation(conversation, currentUserId, unreadCount, undefined, { isContact, otherUserId });
}

async function attachPremiumAccessToConversationMembers(conversations: Array<{ members: Array<{ user: { hasPremiumAccess?: boolean; id: string } }> }>) {
  const userIds = conversations.flatMap((conversation) => conversation.members.map((member) => member.user.id));
  const premiumAccessByUserId = await getPremiumFeatureAccessMap(userIds);

  conversations.forEach((conversation) => {
    conversation.members.forEach((member) => {
      member.user.hasPremiumAccess = premiumAccessByUserId.get(member.user.id) === true;
    });
  });
}

async function assertNoConversationBlocks(conversationId: string, currentUserId: string) {
  const members = await prisma.conversationMember.findMany({
    select: { userId: true },
    where: {
      conversationId,
      userId: { not: currentUserId },
    },
  });
  const otherUserIds = members.map((member) => member.userId);

  if (otherUserIds.length === 0) {
    return;
  }

  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockedId: { in: otherUserIds }, blockerId: currentUserId },
        { blockedId: currentUserId, blockerId: { in: otherUserIds } },
      ],
    },
  });

  if (block) {
    throw new HttpError(403, 'User is blocked');
  }
}

async function assertCanSendConversationMessage(conversationId: string, currentUserId: string) {
  const conversation = await prisma.conversation.findUnique({
    select: {
      members: {
        select: {
          isAdmin: true,
          userId: true,
        },
      },
      ownerId: true,
      ownerOnlyMessages: true,
      type: true,
    },
    where: { id: conversationId },
  });

  if (
    conversation?.type === 'GROUP' &&
    conversation.ownerOnlyMessages &&
    conversation.ownerId !== currentUserId &&
    !conversation.members.some((member) => member.userId === currentUserId && member.isAdmin)
  ) {
    throw new HttpError(403, 'Only group admins can send messages');
  }
}

async function assertMessageMediaAvailable(mediaId: string, userId: string) {
  const media = await prisma.mediaFile.findUnique({
    select: {
      id: true,
      ownerId: true,
      sizeBytes: true,
    },
    where: { id: mediaId },
  });

  if (!media) {
    throw new HttpError(404, 'Media is no longer available');
  }

  if (media.ownerId === userId) {
    return media;
  }

  const sharedMessage = await prisma.message.findFirst({
    select: { id: true },
    where: {
      deletedAt: null,
      mediaId: media.id,
      conversation: {
        members: {
          some: { userId },
        },
      },
    },
  });

  if (!sharedMessage) {
    const sharedStatus = await prisma.statusUpdate.findFirst({
      select: {
        audience: true,
        authorId: true,
        exceptUserIds: true,
        id: true,
        onlyUserIds: true,
      },
      where: {
        deletedAt: null,
        expiresAt: { gt: new Date() },
        mediaId: media.id,
      },
    });

    if (!sharedStatus || !(await canUserAccessStatusMedia(userId, sharedStatus))) {
      throw new HttpError(403, 'Media is not available for forwarding');
    }
  }

  return media;
}

async function canUserAccessStatusMedia(
  userId: string,
  status: Pick<StatusUpdate, 'audience' | 'authorId' | 'exceptUserIds' | 'onlyUserIds'>,
) {
  if (status.authorId === userId) {
    return true;
  }

  const isContact = !!(await prisma.contact.findUnique({
    where: {
      ownerId_contactId: {
        contactId: status.authorId,
        ownerId: userId,
      },
    },
  }));

  if (!isContact) {
    return false;
  }

  if (status.audience === StatusAudience.ONLY_SHARE_WITH) {
    return status.onlyUserIds.includes(userId);
  }

  if (status.audience === StatusAudience.CONTACTS_EXCEPT) {
    return !status.exceptUserIds.includes(userId);
  }

  return true;
}

function getMessageStatusForViewer(
  message: Pick<Message, 'createdAt' | 'senderId' | 'status'> & {
    receipts?: Array<Pick<Prisma.MessageReceiptUncheckedCreateInput, 'status' | 'userId'>>;
  },
  currentUserId: string,
  _members: Array<Pick<ConversationMember, 'lastReadAt' | 'userId'>>,
): MessageStatus {
  if (message.senderId !== currentUserId) {
    return message.status;
  }

  const otherReceipts = (message.receipts ?? []).filter((receipt) => receipt.userId !== currentUserId);

  if (otherReceipts.some((receipt) => receipt.status === 'READ')) {
    return 'READ';
  }

  if (otherReceipts.some((receipt) => receipt.status === 'DELIVERED')) {
    return 'DELIVERED';
  }

  return 'SENT';
}

function createMessageDeleteKey() {
  return crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).padEnd(16, '0');
}

function ensureMessageDeleteKey(metadata?: Record<string, unknown>) {
  const deleteKey = typeof metadata?.deleteKey === 'string' && /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : createMessageDeleteKey();

  return {
    ...(metadata ?? {}),
    deleteKey,
  };
}

function getReactionMetadata(metadata: Record<string, unknown>) {
  const rawReactions = metadata.reactions;

  if (!rawReactions || typeof rawReactions !== 'object' || Array.isArray(rawReactions)) {
    return {};
  }

  return Object.entries(rawReactions as Record<string, unknown>).reduce<Record<string, string>>((result, [userId, emoji]) => {
    if (typeof userId === 'string' && typeof emoji === 'string' && emoji.trim().length > 0) {
      result[userId] = emoji;
    }

    return result;
  }, {});
}

function serializeScheduledMessage(message: ScheduledMessage) {
  return {
    body: message.body,
    cancelledAt: message.cancelledAt?.toISOString() ?? null,
    clientTimezone: message.clientTimezone,
    conversationId: message.conversationId,
    createdAt: message.createdAt.toISOString(),
    failureReason: message.failureReason,
    id: message.id,
    kind: message.kind,
    mediaId: message.mediaId,
    metadata: message.metadata,
    processedAt: message.processedAt?.toISOString() ?? null,
    sendAt: message.sendAt.toISOString(),
    sentMessageId: message.sentMessageId,
    senderId: message.senderId,
    status: message.status,
  };
}

function getDisappearingSecondsAfterView(metadata?: Prisma.JsonValue | null) {
  const metadataObject = getMessageMetadataObject(metadata);
  const rawConfig = metadataObject.disappearingAfterView;

  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return null;
  }

  const seconds = (rawConfig as Record<string, unknown>).seconds;

  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0 && seconds <= 30 * 24 * 60 * 60
    ? seconds
    : null;
}

async function createReactionFallbackMessage(
  req: Request,
  input: {
    conversationId: string;
    emoji: string;
    memberRooms: string[];
    messageId: string;
    senderAliasName?: string | null;
    userId: string;
  },
) {
  const metadata = ensureMessageDeleteKey({
    reactionFallback: {
      emoji: input.emoji,
      messageId: input.messageId,
    },
  });
  const message = await prisma.message.create({
    data: {
      body: input.emoji,
      conversationId: input.conversationId,
      kind: 'TEXT',
      metadata: metadata as Prisma.InputJsonValue,
      senderId: input.userId,
    },
    include: {
      conversation: {
        include: {
          members: {
            select: {
              aliasName: true,
              aliasPromptSeen: true,
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
          showLastSeen: true,
          username: true,
        },
      },
    },
  });
  const io = req.app.get('io');

  io?.to(input.conversationId).to(input.memberRooms).emit('message:new', serializeMessage(message, undefined, input.senderAliasName));
}

function getMessageDeleteKey(message: { id: string; metadata?: Prisma.JsonValue | null }) {
  const metadata = message.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : undefined;
}

function getMessageMetadataObject(metadata?: Prisma.JsonValue | null) {
  return metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

async function queueMessageDeleteRequest(input: {
  conversationId: string;
  deleteKey: string;
  requestedById: string;
}) {
  const recipients = await prisma.conversationMember.findMany({
    select: { userId: true },
    where: {
      conversationId: input.conversationId,
      OR: [
        { aliasPromptSeen: true },
        { conversation: { type: { not: 'GROUP' } } },
      ],
      userId: { not: input.requestedById },
    },
  });

  if (recipients.length === 0) {
    return recipients;
  }

  await prisma.messageDeleteRequest.createMany({
    data: recipients.map((recipient) => ({
      conversationId: input.conversationId,
      messageKey: input.deleteKey,
      mode: 'ALL',
      requestedById: input.requestedById,
      userId: recipient.userId,
    })),
    skipDuplicates: true,
  });

  return recipients;
}

async function queueMessageEditRequest(input: {
  body: string;
  conversationId: string;
  messageId?: string;
  messageKey: string;
  metadata?: Prisma.InputJsonValue;
  requestedById: string;
}) {
  const recipients = await prisma.conversationMember.findMany({
    select: { userId: true },
    where: {
      conversationId: input.conversationId,
      userId: { not: input.requestedById },
    },
  });

  if (recipients.length === 0) {
    return recipients;
  }

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

async function updateConversationPreviewForMissingEdit(
  conversationId: string,
  senderId: string,
  body: string,
  messageCreatedAt?: string,
) {
  if (!messageCreatedAt) {
    return;
  }

  const createdAt = new Date(messageCreatedAt);

  if (Number.isNaN(createdAt.getTime())) {
    return;
  }

  await prisma.conversation.updateMany({
    data: { lastMessageBody: body },
    where: {
      id: conversationId,
      lastMessageAt: createdAt,
      lastMessageKind: 'TEXT',
      lastMessageSenderId: senderId,
    },
  });
}

async function refreshConversationPreview(conversationId: string) {
  const [conversation, latestMessage] = await Promise.all([
    prisma.conversation.findUniqueOrThrow({ select: { createdAt: true }, where: { id: conversationId } }),
    prisma.message.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        body: true,
        createdAt: true,
        kind: true,
        senderId: true,
        status: true,
      },
      where: {
        conversationId,
        deletedAt: null,
      },
    }),
  ]);

  await prisma.conversation.update({
    data: latestMessage
      ? {
          lastMessageAt: latestMessage.createdAt,
          lastMessageBody: latestMessage.body,
          lastMessageKind: latestMessage.kind,
          lastMessageSenderId: latestMessage.senderId,
          lastMessageStatus: latestMessage.status,
          updatedAt: latestMessage.createdAt,
        }
      : {
          lastMessageAt: null,
          lastMessageBody: null,
          lastMessageKind: null,
          lastMessageSenderId: null,
          lastMessageStatus: null,
          updatedAt: conversation.createdAt,
        },
    where: { id: conversationId },
  });
}

function emitConversationRead(
  req: Request,
  conversationId: string,
  readerId: string,
  readAt: Date,
  messageIds: string[] = [],
  messageKeys: string[] = [],
) {
  void prisma.conversation.findUnique({
    include: {
      members: {
        select: { userId: true },
      },
    },
    where: { id: conversationId },
  }).then((conversation) => {
    const memberRooms = conversation?.members.map((member) => `user:${member.userId}`) ?? [];
    req.app.get('io')?.to(memberRooms).emit('message:read', {
      conversationId,
      messageIds,
      messageKeys,
      readAt: readAt.toISOString(),
      readerId,
    });
    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId });
  });
}

export async function purgeAcknowledgedMessageContent(messageIds: string[]) {
  try {
    const messages = await prisma.message.findMany({
      include: {
        messageClientAcks: {
          select: { client: true, userId: true },
        },
        contentAcks: {
          select: { userId: true },
        },
        conversation: {
          select: {
            type: true,
            members: {
              select: { aliasPromptSeen: true, joinedAt: true, userId: true },
            },
          },
        },
        liveLocationShare: {
          select: { id: true },
        },
        media: true,
        pins: {
          select: { id: true },
        },
        reports: {
          select: { id: true },
        },
      },
      where: {
        contentPurgedAt: null,
        deletedAt: null,
        id: { in: messageIds },
      },
    });
    const participantUserIds = uniqueStrings(messages.flatMap((message) => (
      getContentRetentionParticipants(message).map((member) => member.userId)
    )));
    const clientActivityByUserId = await getRecentClientActivityByUserId(participantUserIds);
    const purgeableMessages = messages.filter((message) => {
      const ackedUserIds = new Set(message.contentAcks.map((ack) => ack.userId));
      const clientAcksByUserId = getClientAcksByUserId(message.messageClientAcks);
      const participants = getContentRetentionParticipants(message);

      return participants.length > 0 && participants.every((member) => (
        hasRequiredContentAcksForParticipant(
          message.senderId,
          member.userId,
          ackedUserIds,
          clientAcksByUserId,
          clientActivityByUserId,
        )
      ));
    });

    if (purgeableMessages.length === 0) {
      return;
    }

    const purgedAt = new Date();
    const hardDeleteMessages: typeof purgeableMessages = [];

    for (const message of purgeableMessages) {
      if (!canHardDeleteAcknowledgedMessage(message)) {
        continue;
      }

      const participantIds = getHardDeleteParticipantIds(message);

      if (await areUsersHardDeleteReady(participantIds)) {
        hardDeleteMessages.push(message);
      }
    }

    const hardDeleteMessageIds = new Set(hardDeleteMessages.map((message) => message.id));
    const contentPurgeMessages = purgeableMessages.filter((message) => (
      !hardDeleteMessageIds.has(message.id) && message.kind !== 'CALL'
    ));
    const affectedConversationIds = new Set(purgeableMessages.map((message) => message.conversationId));

    if (hardDeleteMessages.length > 0) {
      await deleteMediaFiles(hardDeleteMessages
        .map((message) => message.media)
        .filter((media): media is NonNullable<typeof media> => !!media));
      await prisma.message.deleteMany({
        where: { id: { in: hardDeleteMessages.map((message) => message.id) } },
      });
    }

    if (contentPurgeMessages.length > 0) {
      const contentPurgeMediaFiles = uniqueMediaFiles(contentPurgeMessages
        .map((message) => message.media)
        .filter((media): media is NonNullable<typeof media> => !!media));

      await prisma.$transaction(contentPurgeMessages
        .map((message) => prisma.message.update({
          data: {
            body: '',
            contentPurgedAt: purgedAt,
            mediaId: null,
            metadata: getRetentionSafeMetadata(message.metadata) as Prisma.InputJsonValue,
          },
          where: { id: message.id },
        })));
      await deleteUnusedMediaFiles(contentPurgeMediaFiles);
    }

    await Promise.all([...affectedConversationIds].map(refreshConversationPreview));
  } catch (error) {
    console.warn('Could not remove acknowledged messages', error);
  }
}

type AcknowledgedMessageForCleanup = Prisma.MessageGetPayload<{
  include: {
    messageClientAcks: {
      select: { client: true; userId: true };
    };
    contentAcks: {
      select: { userId: true };
    };
    conversation: {
      select: {
        members: {
          select: { aliasPromptSeen: true; joinedAt: true; userId: true };
        };
        type: true;
      };
    };
    liveLocationShare: {
      select: { id: true };
    };
    media: true;
    pins: {
      select: { id: true };
    };
    reports: {
      select: { id: true };
    };
  };
}>;

async function getRecentClientActivityByUserId(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, Set<MessageClientIdentity>>();
  }

  const recentClientActivityCutoff = new Date(Date.now() - operationalConfig.retention.clientContentAckHours * HOUR_MS);
  const rows = await prisma.userClientActivity.findMany({
    select: { client: true, userId: true },
    where: {
      lastSeenAt: { gte: recentClientActivityCutoff },
      userId: { in: userIds },
    },
  });
  const activityByUserId = new Map<string, Set<MessageClientIdentity>>();

  rows.forEach((row) => {
    const client = row.client;
    const userClients = activityByUserId.get(row.userId) ?? new Set<MessageClientIdentity>();

    userClients.add(client);
    activityByUserId.set(row.userId, userClients);
  });

  return activityByUserId;
}

function getClientAcksByUserId(acks: Array<{ client: string; userId: string }>) {
  const clientAcksByUserId = new Map<string, Set<MessageClientIdentity>>();

  acks.forEach((ack) => {
    const client = ack.client;
    const userAcks = clientAcksByUserId.get(ack.userId) ?? new Set<MessageClientIdentity>();

    userAcks.add(client);
    clientAcksByUserId.set(ack.userId, userAcks);
  });

  return clientAcksByUserId;
}

async function acknowledgeInlineMessageContent(messageIds: string[], userId: string, client: MessageClientIdentity) {
  if (messageIds.length === 0) {
    return;
  }

  const inlineMessages = await withTransientDatabaseRetry(() => prisma.message.findMany({
    select: { id: true },
    where: {
      id: { in: messageIds },
      kind: 'TEXT',
      mediaId: null,
    },
  }));
  const inlineMessageIds = inlineMessages.map((message) => message.id);

  if (inlineMessageIds.length === 0) {
    return;
  }

  await withTransientDatabaseRetry(() => prisma.messageClientAck.createMany({
    data: inlineMessageIds.map((messageId) => ({
      client,
      messageId,
      userId,
    })),
    skipDuplicates: true,
  }));

  if (getMessageClientKind(client) === 'MOBILE') {
    await withTransientDatabaseRetry(() => prisma.messageContentAck.createMany({
      data: inlineMessageIds.map((messageId) => ({
        messageId,
        userId,
      })),
      skipDuplicates: true,
    }));
  }
}

function hasRequiredContentAcksForParticipant(
  senderId: string,
  userId: string,
  legacyMobileAckedUserIds: Set<string>,
  clientAcksByUserId: Map<string, Set<MessageClientIdentity>>,
  clientActivityByUserId: Map<string, Set<MessageClientIdentity>>,
) {
  const activeClients = clientActivityByUserId.get(userId);
  const clientAcks = clientAcksByUserId.get(userId) ?? new Set<MessageClientIdentity>();

  if (!activeClients || activeClients.size === 0) {
    return userId === senderId || legacyMobileAckedUserIds.has(userId) || clientAcks.size > 0;
  }

  return [...activeClients].every((client) => (
    clientAcks.has(client) ||
    (client === 'MOBILE' && legacyMobileAckedUserIds.has(userId))
  ));
}

function getContentRetentionParticipants(message: AcknowledgedMessageForCleanup) {
  return message.conversation.members.filter((member) => (
    member.userId === message.senderId ||
    (
      message.conversation.type !== 'GROUP' ||
      (member.aliasPromptSeen === true && member.joinedAt.getTime() <= message.createdAt.getTime())
    )
  ));
}

function getHardDeleteParticipantIds(message: AcknowledgedMessageForCleanup) {
  return [...new Set(getContentRetentionParticipants(message).map((member) => member.userId))];
}

function canHardDeleteAcknowledgedMessage(message: AcknowledgedMessageForCleanup) {
  return message.pins.length === 0 &&
    message.reports.length === 0 &&
    !message.liveLocationShare;
}

function getRetentionSafeMetadata(metadata: Prisma.JsonValue | null) {
  const source = getMessageMetadataObject(metadata);
  const safeMetadata: Record<string, unknown> = {};

  if (typeof source.deleteKey === 'string') {
    safeMetadata.deleteKey = source.deleteKey;
  }

  if (source.liveLocation && typeof source.liveLocation === 'object') {
    safeMetadata.liveLocation = source.liveLocation;
  }

  return safeMetadata;
}

async function markMessagesDeliveredByUser(messageIds: string[], userId: string, deliveredAt: Date) {
  if (messageIds.length === 0) {
    return;
  }

  const messages = await withTransientDatabaseRetry(() => prisma.message.findMany({
    select: { conversationId: true, id: true, metadata: true, senderId: true },
    orderBy: { id: 'asc' },
    where: {
      id: { in: messageIds },
      senderId: { not: userId },
    },
  }));
  const visibleMessageIds = messages.map((message) => message.id);

  await upsertMessageReceiptsInStableOrder(visibleMessageIds, userId, 'DELIVERED', deliveredAt);

  await queueMessageStatusUpdates(messages, 'DELIVERED', deliveredAt);
}

async function markConversationMessagesReadByUser(
  conversationIds: string[],
  userId: string,
  readAt: Date,
  requestedMessageIds: string[] = [],
  requestedMessageKeys: string[] = [],
) {
  if (conversationIds.length === 0) {
    return { messageIds: [], messageKeys: [] };
  }
  const identityFilters = buildMessageIdentityFilters(requestedMessageIds, requestedMessageKeys);

  const messages = await withTransientDatabaseRetry(() => prisma.message.findMany({
    select: { conversationId: true, id: true, metadata: true, senderId: true },
    orderBy: { id: 'asc' },
    where: {
      conversationId: { in: conversationIds },
      deletedAt: null,
      deletions: {
        none: { userId },
      },
      ...(identityFilters.length > 0 ? { OR: identityFilters } : {}),
      senderId: { not: userId },
    },
  }));
  const messageIds = messages.map((message) => message.id);
  const messageKeys = messages
    .map((message) => getMessageDeleteKey(message))
    .filter((messageKey): messageKey is string => !!messageKey);
  const queuedReadResult = requestedMessageKeys.length > 0
    ? await markQueuedMessageStatusUpdatesReadByKeys(conversationIds, userId, requestedMessageKeys, readAt)
    : { messageIds: [], messageKeys: [] };

  if (messageIds.length === 0) {
    return {
      messageIds: uniqueStrings(queuedReadResult.messageIds),
      messageKeys: uniqueStrings([...messageKeys, ...queuedReadResult.messageKeys]),
    };
  }

  await upsertMessageReceiptsInStableOrder(messageIds, userId, 'READ', readAt);

  await queueMessageStatusUpdates(messages, 'READ', readAt);

  return {
    messageIds: uniqueStrings([...messageIds, ...queuedReadResult.messageIds]),
    messageKeys: uniqueStrings([...messageKeys, ...queuedReadResult.messageKeys]),
  };
}

function buildMessageIdentityFilters(messageIds: string[], messageKeys: string[]): Prisma.MessageWhereInput[] {
  return [
    ...(messageIds.length > 0 ? [{ id: { in: messageIds } }] : []),
    ...messageKeys.map((messageKey) => ({
      metadata: {
        path: ['deleteKey'],
        equals: messageKey,
      },
    })),
  ];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function upsertMessageReceiptsInStableOrder(
  messageIds: string[],
  userId: string,
  status: 'DELIVERED' | 'READ',
  timestamp: Date,
) {
  const sortedMessageIds = uniqueStrings(messageIds).sort();

  for (let index = 0; index < sortedMessageIds.length; index += RECEIPT_WRITE_BATCH_SIZE) {
    const batch = sortedMessageIds.slice(index, index + RECEIPT_WRITE_BATCH_SIZE);

    await withTransientDatabaseRetry(() => prisma.$transaction(
      batch.map((messageId) => prisma.messageReceipt.upsert({
        create: {
          deliveredAt: timestamp,
          messageId,
          readAt: status === 'READ' ? timestamp : null,
          status,
          userId,
        },
        update: status === 'READ'
          ? {
              deliveredAt: timestamp,
              readAt: timestamp,
              status: 'READ',
            }
          : {
              deliveredAt: timestamp,
            },
        where: {
          messageId_userId: {
            messageId,
            userId,
          },
        },
      })),
    ));
  }
}

async function markQueuedMessageStatusUpdatesReadByKeys(
  conversationIds: string[],
  readerId: string,
  messageKeys: string[],
  readAt: Date,
) {
  const uniqueMessageKeys = uniqueStrings(messageKeys);

  if (conversationIds.length === 0 || uniqueMessageKeys.length === 0) {
    return { messageIds: [], messageKeys: [] };
  }

  const updates = await prisma.messageStatusUpdate.findMany({
    select: { messageId: true, messageKey: true },
    where: {
      conversationId: { in: conversationIds },
      messageKey: { in: uniqueMessageKeys },
      OR: [
        { status: { not: 'READ' } },
        { readAckedAt: null },
      ],
      userId: { not: readerId },
    },
  });

  if (updates.length === 0) {
    return { messageIds: [], messageKeys: [] };
  }

  await withTransientDatabaseRetry(() => prisma.messageStatusUpdate.updateMany({
    data: {
      deliveredAt: readAt,
      readAckedAt: null,
      readAt,
      status: 'READ',
    },
    where: {
      conversationId: { in: conversationIds },
      messageKey: { in: updates.map((update) => update.messageKey) },
      OR: [
        { status: { not: 'READ' } },
        { readAckedAt: null },
      ],
      userId: { not: readerId },
    },
  }));

  return {
    messageIds: updates.map((update) => update.messageId).filter((messageId): messageId is string => !!messageId),
    messageKeys: updates.map((update) => update.messageKey),
  };
}

async function queueMessageStatusUpdates(
  messages: Array<{ conversationId: string; id: string; metadata: Prisma.JsonValue | null; senderId: string }>,
  status: 'DELIVERED' | 'READ',
  timestamp: Date,
) {
  if (messages.length === 0) {
    return;
  }

  const sortedMessages = [...messages].sort((left, right) => {
    const leftKey = `${left.conversationId}:${getMessageDeleteKey(left) ?? left.id}:${left.senderId}`;
    const rightKey = `${right.conversationId}:${getMessageDeleteKey(right) ?? right.id}:${right.senderId}`;

    return leftKey.localeCompare(rightKey);
  });

  for (let index = 0; index < sortedMessages.length; index += RECEIPT_WRITE_BATCH_SIZE) {
    const batch = sortedMessages.slice(index, index + RECEIPT_WRITE_BATCH_SIZE);

    await withTransientDatabaseRetry(() => prisma.$transaction(batch.map((message) => {
      const messageKey = getMessageDeleteKey(message) ?? message.id;

      return prisma.messageStatusUpdate.upsert({
        create: {
          conversationId: message.conversationId,
          deliveredAt: timestamp,
          messageId: message.id,
          messageKey,
          readAt: status === 'READ' ? timestamp : null,
          status,
          userId: message.senderId,
        },
        update: status === 'READ'
          ? {
              deliveredAt: timestamp,
              readAckedAt: null,
              readAt: timestamp,
              status: 'READ',
            }
          : {
              deliveredAt: timestamp,
            },
        where: {
          conversationId_messageKey_userId: {
            conversationId: message.conversationId,
            messageKey,
            userId: message.senderId,
          },
        },
      });
    })));
  }
}

async function withTransientDatabaseRetry<T>(operation: () => Promise<T>, maxAttempts = 5) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientDatabaseConflict(error) || attempt === maxAttempts) {
        throw error;
      }

      await delay(80 * attempt * attempt + Math.floor(Math.random() * 80));
    }
  }

  throw lastError;
}

function isTransientDatabaseConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2024' || error.code === 'P2034')
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('deadlock detected') ||
    error.message.includes('40P01') ||
    error.message.includes('Timed out fetching a new connection') ||
    error.message.includes('could not serialize access') ||
    error.message.includes('40001');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupFullyAcknowledgedDeletedMessages(messageIds: string[]) {
  const messages = await prisma.message.findMany({
    include: {
      deletions: {
        where: { mode: 'ALL' },
      },
      media: true,
    },
    where: {
      deletedAt: { not: null },
      id: { in: messageIds },
    },
  });
  const removableMessages = messages.filter((message) => (
    message.deletions.length > 0 && message.deletions.every((deletion) => !!deletion.ackedAt)
  ));

  if (removableMessages.length === 0) {
    return;
  }

  await deleteMediaFiles(removableMessages
    .map((message) => message.media)
    .filter((media): media is NonNullable<typeof media> => !!media));

  await prisma.message.deleteMany({
    where: { id: { in: removableMessages.map((message) => message.id) } },
  });
}

export async function cleanupExpiredDisappearingMessages(io?: Server, onlyConversationId?: string) {
  const startedAt = Date.now();
  const now = new Date();
  let checkedConversations = 0;
  let processedMessages = 0;
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'asc' },
    select: {
      disappearingMessagesDurationMinutes: true,
      disappearingMessagesSetById: true,
      id: true,
      members: { select: { userId: true } },
    },
    where: {
      disappearingMessagesDurationMinutes: { not: null },
      ...(onlyConversationId ? { id: onlyConversationId } : {}),
      type: 'DIRECT',
    },
  });

  for (const conversation of conversations) {
    if (!onlyConversationId && processedMessages >= DISAPPEARING_MESSAGE_CLEANUP_MAX_PER_RUN) {
      break;
    }

    checkedConversations += 1;
    const durationMinutes = conversation.disappearingMessagesDurationMinutes;
    const requestedById = conversation.disappearingMessagesSetById;

    if (!durationMinutes || !requestedById) {
      continue;
    }

    const messages = await prisma.message.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, metadata: true },
      take: Math.min(
        DISAPPEARING_MESSAGE_CLEANUP_BATCH_SIZE,
        DISAPPEARING_MESSAGE_CLEANUP_MAX_PER_RUN - processedMessages,
      ),
      where: {
        conversationId: conversation.id,
        createdAt: { lte: new Date(now.getTime() - durationMinutes * 60 * 1000) },
        deletedAt: null,
      },
    });

    if (messages.length === 0) {
      continue;
    }

    processedMessages += messages.length;
    const messageIds = messages.map((message) => message.id);
    const deletionCreatedAt = new Date();
    await deleteMessageMediaFiles(messageIds);
    await prisma.$transaction([
      prisma.message.updateMany({
        data: { body: '', contentPurgedAt: deletionCreatedAt, deletedAt: deletionCreatedAt, mediaId: null },
        where: { id: { in: messageIds } },
      }),
      prisma.messagePin.deleteMany({
        where: { conversationId: conversation.id, messageId: { in: messageIds } },
      }),
      prisma.conversation.update({
        data: { disappearingMessagesExpiredAt: deletionCreatedAt },
        where: { id: conversation.id },
      }),
    ]);
    await Promise.all(messages.flatMap((message) => (
      conversation.members.map((member) => prisma.messageDeletion.upsert({
        create: {
          createdAt: deletionCreatedAt,
          messageId: message.id,
          mode: 'ALL',
          requestedById,
          userId: member.userId,
        },
        update: {
          ackedAt: null,
          createdAt: deletionCreatedAt,
          mode: 'ALL',
          requestedById,
        },
        where: {
          messageId_userId: {
            messageId: message.id,
            userId: member.userId,
          },
        },
      }))
    )));
    await Promise.all(messages.map(async (message) => {
      const deleteKey = getMessageDeleteKey(message);

      if (deleteKey) {
        await queueMessageDeleteRequest({
          conversationId: conversation.id,
          deleteKey,
          requestedById,
        });
      }
    }));
    await refreshConversationPreview(conversation.id);

    const memberRooms = conversation.members.map((member) => `user:${member.userId}`);
    messages.forEach((message) => {
      io?.to(conversation.id).to(memberRooms).emit('message:deleted', {
        conversationId: conversation.id,
        messageId: message.id,
        ...(getMessageDeleteKey(message) ? { messageKey: getMessageDeleteKey(message) } : {}),
        mode: 'all',
        userId: requestedById,
      });
    });
    io?.to(memberRooms).emit('conversation:updated', { conversationId: conversation.id });

    if (!onlyConversationId && processedMessages >= DISAPPEARING_MESSAGE_CLEANUP_MAX_PER_RUN) {
      break;
    }
  }

  const durationMs = Date.now() - startedAt;

  if (!onlyConversationId && (processedMessages > 0 || durationMs > 1000)) {
    console.log('Disappearing message cleanup completed', {
      checkedConversations,
      durationMs,
      limited: processedMessages >= DISAPPEARING_MESSAGE_CLEANUP_MAX_PER_RUN,
      processedMessages,
    });
  }
}

export async function processDueScheduledMessages(io?: Server) {
  const now = new Date();
  const scheduledMessages = await prisma.scheduledMessage.findMany({
    orderBy: [{ sendAt: 'asc' }, { createdAt: 'asc' }],
    take: SCHEDULED_MESSAGE_DELIVERY_BATCH_SIZE,
    where: {
      sendAt: { lte: now },
      status: 'PENDING',
    },
  });

  if (scheduledMessages.length === 0) {
    return;
  }

  let delivered = 0;
  let failed = 0;

  for (const scheduledMessage of scheduledMessages) {
    const claimed = await prisma.scheduledMessage.updateMany({
      data: { status: 'PROCESSING' },
      where: {
        id: scheduledMessage.id,
        status: 'PENDING',
      },
    });

    if (claimed.count === 0) {
      continue;
    }

    try {
      const fakeReq = {
        app: { get: (key: string) => key === 'io' ? io : undefined },
        body: { client: 'MOBILE' },
        messageClient: 'MOBILE',
      } as unknown as Request;
      const scheduledMetadata = getMessageMetadataObject(scheduledMessage.metadata);
      const { message } = await createAndBroadcastConversationMessage(fakeReq, scheduledMessage.conversationId, scheduledMessage.senderId, {
        body: scheduledMessage.body,
        kind: scheduledMessage.kind,
        mediaId: scheduledMessage.mediaId ?? undefined,
        metadata: {
          ...scheduledMetadata,
          scheduledMessageId: scheduledMessage.id,
          scheduledSendAt: scheduledMessage.sendAt.toISOString(),
        },
      });

      await prisma.scheduledMessage.update({
        data: {
          processedAt: new Date(),
          sentMessageId: message.id,
          status: 'SENT',
        },
        where: { id: scheduledMessage.id },
      });
      delivered += 1;
    } catch (error) {
      failed += 1;
      await prisma.scheduledMessage.update({
        data: {
          failureReason: error instanceof Error ? error.message.slice(0, 1000) : 'Scheduled delivery failed',
          processedAt: new Date(),
          status: 'FAILED',
        },
        where: { id: scheduledMessage.id },
      });
      console.warn('Scheduled message delivery failed', {
        conversationId: scheduledMessage.conversationId,
        error,
        scheduledMessageId: scheduledMessage.id,
      });
    }
  }

  if (delivered > 0 || failed > 0) {
    console.log('Scheduled message delivery completed', { delivered, failed });
  }
}

export async function cleanupExpiredViewDisappearingMessages(io?: Server) {
  const now = new Date();
  const views = await prisma.disappearingMessageView.findMany({
    include: {
      message: {
        select: {
          id: true,
          metadata: true,
        },
      },
    },
    orderBy: [{ deleteAt: 'asc' }, { createdAt: 'asc' }],
    take: VIEW_DISAPPEARING_MESSAGE_CLEANUP_BATCH_SIZE,
    where: {
      deleteAt: { lte: now },
      deletedAt: null,
    },
  });

  if (views.length === 0) {
    return;
  }

  const deletedAt = new Date();

  for (const view of views) {
    await prisma.$transaction([
      prisma.disappearingMessageView.update({
        data: { deletedAt },
        where: { id: view.id },
      }),
      prisma.messageDeletion.upsert({
        create: {
          createdAt: deletedAt,
          messageId: view.messageId,
          mode: 'SELF',
          requestedById: view.senderId,
          userId: view.viewerId,
        },
        update: {
          ackedAt: null,
          createdAt: deletedAt,
          mode: 'SELF',
          requestedById: view.senderId,
        },
        where: {
          messageId_userId: {
            messageId: view.messageId,
            userId: view.viewerId,
          },
        },
      }),
    ]);

    const payload = {
      conversationId: view.conversationId,
      messageId: view.messageId,
      ...(getMessageDeleteKey(view.message) ? { messageKey: getMessageDeleteKey(view.message) } : {}),
      mode: 'me',
      userId: view.viewerId,
    };

    io?.to(`user:${view.viewerId}`).emit('message:deleted', payload);
    io?.to(`user:${view.viewerId}`).emit('conversation:updated', { conversationId: view.conversationId });
  }

  console.log('View disappearing message cleanup completed', { processed: views.length });
}

async function deleteMessageMediaFiles(messageIds: string[]) {
  const messages = await prisma.message.findMany({
    include: { media: true },
    where: { id: { in: messageIds } },
  });

  await deleteMediaFiles(messages
    .map((message) => message.media)
    .filter((media): media is NonNullable<typeof media> => !!media));
}

function uniqueMediaFiles<T extends { id: string; storageKey: string }>(mediaFiles: T[]) {
  const mediaById = new Map<string, T>();

  mediaFiles.forEach((media) => {
    mediaById.set(media.id, media);
  });

  return [...mediaById.values()];
}

async function deleteMediaFiles(mediaFiles: Array<{ id: string; storageKey: string }>) {
  if (mediaFiles.length === 0) {
    return;
  }

  await prisma.mediaFile.deleteMany({
    where: { id: { in: mediaFiles.map((media) => media.id) } },
  });
  await Promise.all(mediaFiles.map(async (media) => {
    const filePath = path.resolve(uploadDir, media.storageKey);

    if (!filePath.startsWith(`${uploadDir}${path.sep}`)) {
      return;
    }

    await fs.unlink(filePath).catch(() => undefined);
  }));
}

async function deleteUnusedMediaFiles(mediaFiles: Array<{ id: string; storageKey: string }>) {
  if (mediaFiles.length === 0) {
    return;
  }

  const candidateMediaById = new Map(uniqueMediaFiles(mediaFiles).map((media) => [media.id, media]));
  const unusedMedia = await prisma.mediaFile.findMany({
    select: { id: true, storageKey: true },
    where: {
      id: { in: [...candidateMediaById.keys()] },
      messages: { none: {} },
    },
  });

  await deleteMediaFiles(unusedMedia);
}

async function sendMessageNotification(input: {
  avatarUrl?: string | null;
  body: string;
  conversationId: string;
  messageId: string;
  senderId: string;
  title: string;
}) {
  const tokens = await prisma.devicePushToken.findMany({
    select: {
      locale: true,
      platform: true,
      provider: true,
      token: true,
      userId: true,
    },
    where: {
      user: {
        memberships: {
          some: {
            conversationId: input.conversationId,
            AND: [
              {
                OR: [
                  { mutedAt: null },
                  { mutedUntil: { lte: new Date() } },
                ],
              },
              {
                OR: [
                  { aliasPromptSeen: true },
                  { conversation: { type: { not: 'GROUP' } } },
                ],
              },
            ],
          },
        },
      },
      userId: { not: input.senderId },
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

function getPushBodyForMessage(message: Pick<Message, 'body' | 'kind'>) {
  if (message.kind === 'IMAGE') {
    return message.body || 'Photo';
  }

  if (message.kind === 'VIDEO') {
    return message.body || 'Video';
  }

  if (message.kind === 'FILE') {
    return message.body || 'File';
  }

  if (message.kind === 'VOICE') {
    return 'Voice message';
  }

  return message.body || 'New message';
}

function getMessageAvatarUrl(message: {
  conversation?: { avatarUrl?: string | null; type?: string | null };
  sender: { avatarUrl?: string | null };
}) {
  return message.conversation?.type === 'GROUP'
    ? message.conversation.avatarUrl ?? message.sender.avatarUrl ?? null
    : message.sender.avatarUrl ?? null;
}
