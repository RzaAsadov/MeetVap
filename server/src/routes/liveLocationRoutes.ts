import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { Request, Router } from 'express';

import { getAuthedUser } from '../auth';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { sendMessagePush } from '../pushNotifications';
import { operationalConfig } from '../operationalConfig';
import { enforceRateLimit } from '../rateLimits';
import { serializeMessage } from '../serializers';
import { createLiveLocationSchema, updateLiveLocationSchema } from '../validators';

export const liveLocationRoutes = Router();
const MINIMUM_UPDATE_INTERVAL_MS = 55 * 1000;

liveLocationRoutes.post('/', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createLiveLocationSchema.parse(req.body);
    await enforceRateLimit(currentUser.id, 'text-message', operationalConfig.rateLimits.textMessagesPerMinute);
    await getAcceptedMembership(input.conversationId, currentUser.id);
    await assertNoConversationBlocks(input.conversationId, currentUser.id);
    await assertCanSendMessage(input.conversationId, currentUser.id);
    const startedAt = new Date();
    const activeShare = await prisma.liveLocationShare.findFirst({
      select: { id: true },
      where: {
        conversationId: input.conversationId,
        expiresAt: { gt: startedAt },
        ownerId: currentUser.id,
        stoppedAt: null,
      },
    });

    if (activeShare) {
      throw new HttpError(409, 'You already have an active live location share');
    }

    const expiresAt = new Date(startedAt.getTime() + input.durationMinutes * 60 * 1000);
    const liveLocationId = crypto.randomUUID();
    const metadata = createLiveLocationMetadata({
      address: input.address,
      clientId: input.clientId,
      expiresAt,
      id: liveLocationId,
      latitude: input.latitude,
      longitude: input.longitude,
      startedAt,
    });

    const message = await prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({
        data: {
          body: 'Live location',
          conversationId: input.conversationId,
          metadata: metadata as Prisma.InputJsonValue,
          senderId: currentUser.id,
        },
        include: {
          conversation: {
            include: {
              members: {
                select: { aliasName: true, aliasPromptSeen: true, userId: true },
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

      await tx.liveLocationShare.create({
        data: {
          address: input.address,
          conversationId: input.conversationId,
          expiresAt,
          id: liveLocationId,
          latitude: input.latitude,
          longitude: input.longitude,
          messageId: createdMessage.id,
          ownerId: currentUser.id,
          startedAt,
        },
      });
      await tx.conversation.update({
        data: {
          lastMessageAt: startedAt,
          lastMessageBody: createdMessage.body,
          lastMessageKind: createdMessage.kind,
          lastMessageSenderId: createdMessage.senderId,
          lastMessageStatus: createdMessage.status,
          updatedAt: startedAt,
        },
        where: { id: input.conversationId },
      });
      await tx.conversationMember.update({
        data: { lastReadAt: startedAt },
        where: { conversationId_userId: { conversationId: input.conversationId, userId: currentUser.id } },
      });

      return createdMessage;
    });

    const memberRooms = message.conversation.members
      .filter((member) => message.conversation.type !== 'GROUP' || member.userId === currentUser.id || member.aliasPromptSeen === true)
      .map((member) => `user:${member.userId}`);
    const senderAliasName = message.conversation.members.find((member) => member.userId === currentUser.id)?.aliasName;
    const serializedMessage = serializeMessage(message, undefined, senderAliasName);

    req.app.get('io')?.to(input.conversationId).to(memberRooms).emit('message:new', serializedMessage);
    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: input.conversationId });
    void sendInitialLiveLocationPush(input.conversationId, currentUser.id, message.id, senderAliasName || message.sender.displayName || message.sender.username).catch(() => undefined);
    res.status(201).json({ liveLocation: metadata.liveLocation, message: serializedMessage });
  } catch (error) {
    next(error);
  }
});

liveLocationRoutes.patch('/:liveLocationId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateLiveLocationSchema.parse(req.body);
    const share = await getOwnedActiveShare(req.params.liveLocationId, currentUser.id);
    const now = new Date();

    if (now.getTime() - share.updatedAt.getTime() < MINIMUM_UPDATE_INTERVAL_MS) {
      res.json({ liveLocation: serializeLiveLocation(share) });
      return;
    }

    const updated = await prisma.liveLocationShare.update({
      data: { address: input.address, latitude: input.latitude, longitude: input.longitude },
      where: { id: share.id },
    });
    const metadata = await updateShareMessageMetadata(updated);
    void emitUpdatedShare(req, updated.conversationId, updated.messageId, metadata).catch(() => undefined);
    res.json({ liveLocation: metadata.liveLocation });
  } catch (error) {
    next(error);
  }
});

liveLocationRoutes.post('/:liveLocationId/stop', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const share = await prisma.liveLocationShare.findFirst({
      where: { id: req.params.liveLocationId, ownerId: currentUser.id },
    });

    if (!share) {
      throw new HttpError(404, 'Live location not found');
    }

    const updated = share.stoppedAt
      ? share
      : await prisma.liveLocationShare.update({ data: { stoppedAt: new Date() }, where: { id: share.id } });
    const metadata = await updateShareMessageMetadata(updated);
    void emitUpdatedShare(req, updated.conversationId, updated.messageId, metadata).catch(() => undefined);
    res.json({ liveLocation: metadata.liveLocation });
  } catch (error) {
    next(error);
  }
});

async function emitUpdatedShare(req: Request, conversationId: string, messageId: string, metadata: Record<string, unknown>) {
  const conversation = await prisma.conversation.findUnique({
    select: {
      members: {
        select: {
          aliasPromptSeen: true,
          userId: true,
        },
      },
      type: true,
    },
    where: { id: conversationId },
  });
  const memberRooms = conversation?.members
    .filter((member) => conversation.type !== 'GROUP' || member.aliasPromptSeen === true)
    .map((member) => `user:${member.userId}`) ?? [];

  req.app.get('io')?.to(conversationId).to(memberRooms).emit('live-location:updated', { conversationId, messageId, metadata });
}

async function assertNoConversationBlocks(conversationId: string, currentUserId: string) {
  const members = await prisma.conversationMember.findMany({
    select: { userId: true },
    where: { conversationId, userId: { not: currentUserId } },
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

async function getAcceptedMembership(conversationId: string, userId: string) {
  const membership = await prisma.conversationMember.findUnique({
    include: { conversation: true },
    where: { conversationId_userId: { conversationId, userId } },
  });

  if (!membership || (membership.conversation.type === 'GROUP' && membership.conversation.ownerId !== userId && membership.aliasPromptSeen === false)) {
    throw new HttpError(403, 'Conversation is unavailable');
  }

  return membership;
}

async function assertCanSendMessage(conversationId: string, userId: string) {
  const membership = await getAcceptedMembership(conversationId, userId);

  if (membership.conversation.type === 'GROUP' && membership.conversation.ownerOnlyMessages && membership.conversation.ownerId !== userId && !membership.isAdmin) {
    throw new HttpError(403, 'Only group admins can send messages');
  }
}

async function getOwnedActiveShare(id: string, ownerId: string) {
  const share = await prisma.liveLocationShare.findFirst({ where: { id, ownerId } });

  if (!share || share.stoppedAt || share.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(404, 'Live location is no longer active');
  }

  return share;
}

function createLiveLocationMetadata(input: {
  address?: string | null;
  clientId?: string;
  expiresAt: Date;
  id: string;
  latitude: number;
  longitude: number;
  startedAt: Date;
  stoppedAt?: Date | null;
  updatedAt?: Date;
}) {
  return {
    ...(input.clientId ? { clientId: input.clientId } : {}),
    deleteKey: crypto.randomBytes(12).toString('base64url').slice(0, 16),
    liveLocation: serializeLiveLocation(input),
  };
}

async function updateShareMessageMetadata(share: {
  address?: string | null;
  conversationId: string;
  expiresAt: Date;
  id: string;
  latitude: number;
  longitude: number;
  messageId: string;
  startedAt: Date;
  stoppedAt?: Date | null;
  updatedAt?: Date;
}) {
  const message = await prisma.message.findUnique({ select: { metadata: true }, where: { id: share.messageId } });
  const currentMetadata = message?.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {};
  const metadata = {
    ...currentMetadata,
    liveLocation: serializeLiveLocation(share),
  };
  await prisma.message.update({
    data: { metadata: metadata as Prisma.InputJsonValue },
    where: { id: share.messageId },
  });
  return metadata;
}

function serializeLiveLocation(input: {
  address?: string | null;
  expiresAt: Date;
  id: string;
  latitude: number;
  longitude: number;
  startedAt: Date;
  stoppedAt?: Date | null;
  updatedAt?: Date;
}) {
  return {
    address: input.address ?? undefined,
    expiresAt: input.expiresAt.toISOString(),
    id: input.id,
    latitude: input.latitude,
    longitude: input.longitude,
    startedAt: input.startedAt.toISOString(),
    stoppedAt: input.stoppedAt?.toISOString(),
    updatedAt: (input.updatedAt ?? input.startedAt).toISOString(),
  };
}

async function sendInitialLiveLocationPush(conversationId: string, senderId: string, messageId: string, title: string) {
  const tokens = await prisma.devicePushToken.findMany({
    select: { locale: true, platform: true, provider: true, token: true },
    where: {
      user: {
        memberships: {
          some: {
            conversationId,
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
      userId: { not: senderId },
    },
  });
  await sendMessagePush({ body: 'Live location', conversationId, messageId, title, tokens });
}
