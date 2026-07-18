import { MessageKind, Prisma, StatusAudience, StatusKind } from '@prisma/client';
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';

import { getAuthedUser, requireAuth } from '../auth';
import { config } from '../config';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { serializeUser } from '../serializers';
import { assertNotBlockedBetween } from './userRoutes';
import { createAndBroadcastConversationMessage } from './conversationRoutes';

export const statusRoutes = Router();

const uploadDir = path.resolve(config.UPLOAD_DIR);
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const STATUS_TEXT_MAX_LENGTH = 700;
const STATUS_REPLY_MAX_LENGTH = 2_000;
const STATUS_CLEANUP_BATCH_SIZE = 500;

const createStatusSchema = z.object({
  audience: z.enum(['CONTACTS', 'CONTACTS_EXCEPT', 'ONLY_SHARE_WITH']).optional(),
  backgroundColor: z.string().trim().max(32).optional().nullable(),
  body: z.string().max(STATUS_TEXT_MAX_LENGTH).optional(),
  exceptUserIds: z.array(z.string().min(1)).max(500).optional(),
  kind: z.enum(['TEXT', 'IMAGE', 'VIDEO']),
  mediaId: z.string().min(1).optional().nullable(),
  onlyUserIds: z.array(z.string().min(1)).max(500).optional(),
});

const replyStatusSchema = z.object({
  body: z.string().trim().min(1).max(STATUS_REPLY_MAX_LENGTH),
});

type StatusWithRelations = Prisma.StatusUpdateGetPayload<{
  include: {
    author: true;
    media: true;
    views: {
      include: {
        viewer: true;
      };
    };
  };
}>;

statusRoutes.use(requireAuth);

statusRoutes.get('/summary', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const visibleStatuses = await findVisibleStatuses(currentUser.id);
    const hasUnviewed = visibleStatuses.some((status) => (
      status.authorId !== currentUser.id &&
      !status.views.some((view) => view.viewerId === currentUser.id)
    ));

    res.json({
      count: visibleStatuses.filter((status) => status.authorId !== currentUser.id).length,
      hasUnviewed,
    });
  } catch (error) {
    next(error);
  }
});

statusRoutes.get('/', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const statuses = await findVisibleStatuses(currentUser.id);

    res.json({ groups: groupStatuses(statuses, currentUser.id) });
  } catch (error) {
    next(error);
  }
});

statusRoutes.post('/', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createStatusSchema.parse(req.body);
    const kind = input.kind as StatusKind;
    const body = (input.body ?? '').trim();
    const mediaId = input.mediaId?.trim() || null;

    if (kind === StatusKind.TEXT && body.length === 0) {
      throw new HttpError(400, 'Status text is required');
    }

    if ((kind === StatusKind.IMAGE || kind === StatusKind.VIDEO) && !mediaId) {
      throw new HttpError(400, 'Status media is required');
    }

    if (mediaId) {
      const media = await prisma.mediaFile.findUnique({
        select: { id: true, ownerId: true },
        where: { id: mediaId },
      });

      if (!media || media.ownerId !== currentUser.id) {
        throw new HttpError(403, 'Media is not available for status');
      }
    }

    const audience = (input.audience ?? 'CONTACTS') as StatusAudience;
    const exceptUserIds = uniqueIds(input.exceptUserIds ?? []).filter((userId) => userId !== currentUser.id);
    const onlyUserIds = uniqueIds(input.onlyUserIds ?? []).filter((userId) => userId !== currentUser.id);
    await assertStatusAudienceUsers(currentUser.id, audience, audience === StatusAudience.ONLY_SHARE_WITH ? onlyUserIds : exceptUserIds);

    const status = await prisma.statusUpdate.create({
      data: {
        audience,
        authorId: currentUser.id,
        backgroundColor: normalizeBackgroundColor(input.backgroundColor),
        body,
        exceptUserIds,
        expiresAt: new Date(Date.now() + STATUS_TTL_MS),
        kind,
        mediaId,
        onlyUserIds,
      },
      include: statusInclude,
    });

    const rooms = await getStatusRecipientRooms(currentUser.id, status);
    req.app.get('io')?.to(rooms).emit('status:updated', { authorId: currentUser.id, statusId: status.id });
    res.status(201).json({ status: serializeStatus(status, currentUser.id) });
  } catch (error) {
    next(error);
  }
});

statusRoutes.post('/:statusId/view', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const status = await getVisibleStatus(req.params.statusId, currentUser.id);

    if (status.authorId !== currentUser.id) {
      await prisma.statusView.upsert({
        create: {
          statusId: status.id,
          viewerId: currentUser.id,
        },
        update: {
          viewedAt: new Date(),
        },
        where: {
          statusId_viewerId: {
            statusId: status.id,
            viewerId: currentUser.id,
          },
        },
      });
      req.app.get('io')?.to(`user:${status.authorId}`).emit('status:viewed', {
        statusId: status.id,
        viewerId: currentUser.id,
      });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

statusRoutes.post('/:statusId/reply', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = replyStatusSchema.parse(req.body);
    const status = await getVisibleStatus(req.params.statusId, currentUser.id);

    if (status.authorId === currentUser.id) {
      throw new HttpError(400, 'Cannot reply to your own status');
    }

    await assertNotBlockedBetween(currentUser.id, status.authorId);
    const conversationId = await ensureDirectConversation(currentUser.id, status.authorId);
    const statusPreview = status.kind === StatusKind.TEXT
      ? status.body.slice(0, 120)
      : status.kind === StatusKind.IMAGE ? 'Photo status' : 'Video status';
    const replyKind = status.kind === StatusKind.IMAGE
      ? MessageKind.IMAGE
      : status.kind === StatusKind.VIDEO ? MessageKind.VIDEO : MessageKind.TEXT;
    const { serializedMessage } = await createAndBroadcastConversationMessage(req, conversationId, currentUser.id, {
      body: input.body,
      kind: replyKind,
      mediaId: replyKind === MessageKind.TEXT ? undefined : status.mediaId ?? undefined,
      metadata: {
        statusReply: {
          authorId: status.authorId,
          kind: status.kind,
          preview: statusPreview,
          statusId: status.id,
        },
      },
    });

    res.status(201).json({ conversationId, message: serializedMessage });
  } catch (error) {
    next(error);
  }
});

statusRoutes.delete('/:statusId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const status = await prisma.statusUpdate.findUnique({
      select: { authorId: true, id: true },
      where: { id: req.params.statusId },
    });

    if (!status || status.authorId !== currentUser.id) {
      throw new HttpError(404, 'Status not found');
    }

    await prisma.statusUpdate.update({
      data: { deletedAt: new Date() },
      where: { id: status.id },
    });
    const rooms = await getStatusRecipientRooms(currentUser.id);
    req.app.get('io')?.to(rooms).emit('status:updated', { authorId: currentUser.id, statusId: status.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

statusRoutes.get('/:statusId/views', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const status = await prisma.statusUpdate.findUnique({
      include: {
        views: {
          include: { viewer: true },
          orderBy: { viewedAt: 'desc' },
        },
      },
      where: { id: req.params.statusId },
    });

    if (!status || status.authorId !== currentUser.id) {
      throw new HttpError(404, 'Status not found');
    }

    res.json({
      viewers: status.views.map((view) => ({
        user: serializeUser(view.viewer),
        viewedAt: view.viewedAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

const statusInclude = {
  author: true,
  media: true,
  views: {
    include: {
      viewer: true,
    },
  },
} satisfies Prisma.StatusUpdateInclude;

async function findVisibleStatuses(currentUserId: string) {
  const now = new Date();
  const contactIds = await getContactIds(currentUserId);

  if (contactIds.length === 0) {
    return prisma.statusUpdate.findMany({
      include: statusInclude,
      orderBy: { createdAt: 'asc' },
      where: {
        authorId: currentUserId,
        deletedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  const statuses = await prisma.statusUpdate.findMany({
    include: statusInclude,
    orderBy: { createdAt: 'asc' },
    where: {
      deletedAt: null,
      expiresAt: { gt: now },
      OR: [
        { authorId: currentUserId },
        { authorId: { in: contactIds } },
      ],
    },
  });

  return statuses.filter((status) => isStatusVisibleToUser(status, currentUserId, contactIds));
}

async function getVisibleStatus(statusId: string, currentUserId: string) {
  const contactIds = await getContactIds(currentUserId);
  const status = await prisma.statusUpdate.findUnique({
    include: statusInclude,
    where: { id: statusId },
  });

  if (!status || status.deletedAt || status.expiresAt <= new Date() || !isStatusVisibleToUser(status, currentUserId, contactIds)) {
    throw new HttpError(404, 'Status not found');
  }

  return status;
}

function groupStatuses(statuses: StatusWithRelations[], currentUserId: string) {
  const groupsByAuthorId = new Map<string, { author: ReturnType<typeof serializeUser>; hasUnviewed: boolean; latestAt: string; statuses: ReturnType<typeof serializeStatus>[] }>();

  for (const status of statuses) {
    const serializedStatus = serializeStatus(status, currentUserId);
    const existing = groupsByAuthorId.get(status.authorId);
    const hasUnviewed = status.authorId !== currentUserId && !serializedStatus.viewedByMe;
    const latestAt = status.createdAt.toISOString();

    if (!existing) {
      groupsByAuthorId.set(status.authorId, {
        author: serializeUser(status.author),
        hasUnviewed,
        latestAt,
        statuses: [serializedStatus],
      });
      continue;
    }

    existing.statuses.push(serializedStatus);
    existing.hasUnviewed = existing.hasUnviewed || hasUnviewed;
    if (latestAt > existing.latestAt) {
      existing.latestAt = latestAt;
    }
  }

  return [...groupsByAuthorId.values()].sort((a, b) => {
    const ownA = a.statuses[0]?.authorId === currentUserId;
    const ownB = b.statuses[0]?.authorId === currentUserId;
    if (ownA !== ownB) {
      return ownA ? -1 : 1;
    }

    if (a.hasUnviewed !== b.hasUnviewed) {
      return a.hasUnviewed ? -1 : 1;
    }

    return b.latestAt.localeCompare(a.latestAt);
  });
}

function serializeStatus(status: StatusWithRelations, currentUserId: string) {
  return {
    audience: status.audience,
    authorId: status.authorId,
    backgroundColor: status.backgroundColor,
    body: status.body,
    createdAt: status.createdAt.toISOString(),
    expiresAt: status.expiresAt.toISOString(),
    id: status.id,
    kind: status.kind,
    media: status.media ? {
      durationSec: status.media.durationSec,
      id: status.media.id,
      mimeType: status.media.mimeType,
      originalName: status.media.originalName,
      sizeBytes: status.media.sizeBytes,
    } : null,
    mediaId: status.mediaId,
    viewedByMe: status.authorId === currentUserId || status.views.some((view) => view.viewerId === currentUserId),
    viewerCount: status.authorId === currentUserId ? status.views.length : undefined,
  };
}

function isStatusVisibleToUser(status: StatusWithRelations, currentUserId: string, contactIds: string[]) {
  if (status.authorId === currentUserId) {
    return true;
  }

  if (!contactIds.includes(status.authorId)) {
    return false;
  }

  if (status.audience === StatusAudience.ONLY_SHARE_WITH) {
    return status.onlyUserIds.includes(currentUserId);
  }

  if (status.audience === StatusAudience.CONTACTS_EXCEPT) {
    return !status.exceptUserIds.includes(currentUserId);
  }

  return true;
}

async function getContactIds(userId: string) {
  const contacts = await prisma.contact.findMany({
    select: { contactId: true },
    where: { ownerId: userId },
  });

  return contacts.map((contact) => contact.contactId);
}

async function assertStatusAudienceUsers(currentUserId: string, audience: StatusAudience, userIds: string[]) {
  if (audience === StatusAudience.CONTACTS || userIds.length === 0) {
    return;
  }

  const contactIds = new Set(await getContactIds(currentUserId));
  const invalidUserId = userIds.find((userId) => !contactIds.has(userId));

  if (invalidUserId) {
    throw new HttpError(400, 'Status audience must contain only contacts');
  }
}

async function getStatusRecipientRooms(authorId: string, status?: Pick<StatusWithRelations, 'audience' | 'exceptUserIds' | 'onlyUserIds'>) {
  const contactIds = await getContactIds(authorId);
  const recipientIds = status
    ? contactIds.filter((contactId) => {
      if (status.audience === StatusAudience.ONLY_SHARE_WITH) {
        return status.onlyUserIds.includes(contactId);
      }

      if (status.audience === StatusAudience.CONTACTS_EXCEPT) {
        return !status.exceptUserIds.includes(contactId);
      }

      return true;
    })
    : contactIds;

  return [`user:${authorId}`, ...recipientIds.map((userId) => `user:${userId}`)];
}

async function ensureDirectConversation(userId: string, peerId: string) {
  const existing = await prisma.conversation.findFirst({
    select: { id: true },
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: peerId } } },
      ],
    },
  });

  if (existing) {
    await prisma.conversationDeletion.deleteMany({
      where: {
        conversationId: existing.id,
        userId,
      },
    });
    return existing.id;
  }

  const conversation = await prisma.conversation.create({
    data: {
      members: {
        create: [
          { userId },
          { userId: peerId },
        ],
      },
      type: 'DIRECT',
    },
    select: { id: true },
  });

  return conversation.id;
}

function uniqueIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeBackgroundColor(value: string | null | undefined) {
  const color = value?.trim();
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

export async function cleanupExpiredStatuses(io?: SocketIOServer) {
  const expiredStatuses = await prisma.statusUpdate.findMany({
    select: {
      authorId: true,
      id: true,
      media: {
        select: {
          id: true,
          storageKey: true,
        },
      },
    },
    take: STATUS_CLEANUP_BATCH_SIZE,
    where: {
      expiresAt: { lte: new Date() },
    },
  });

  if (expiredStatuses.length === 0) {
    return { deletedStatuses: 0, deletedMedia: 0 };
  }

  const statusIds = expiredStatuses.map((status) => status.id);
  const authorIds = [...new Set(expiredStatuses.map((status) => status.authorId))];
  const candidateMediaById = new Map(
    expiredStatuses
      .map((status) => status.media)
      .filter((media): media is { id: string; storageKey: string } => !!media)
      .map((media) => [media.id, media]),
  );

  await prisma.statusUpdate.deleteMany({
    where: { id: { in: statusIds } },
  });

  const unusedMedia = candidateMediaById.size > 0
    ? await prisma.mediaFile.findMany({
      select: {
        id: true,
        storageKey: true,
      },
      where: {
        id: { in: [...candidateMediaById.keys()] },
        messages: { none: {} },
        scheduledMessages: { none: {} },
        statusUpdates: { none: {} },
      },
    })
    : [];

  await deleteStatusMediaFiles(unusedMedia);
  await emitStatusCleanupUpdates(io, authorIds);

  return {
    deletedMedia: unusedMedia.length,
    deletedStatuses: expiredStatuses.length,
  };
}

async function emitStatusCleanupUpdates(io: SocketIOServer | undefined, authorIds: string[]) {
  if (!io || authorIds.length === 0) {
    return;
  }

  const contacts = await prisma.contact.findMany({
    select: {
      contactId: true,
      ownerId: true,
    },
    where: {
      ownerId: { in: authorIds },
    },
  });
  const rooms = new Set<string>();

  for (const authorId of authorIds) {
    rooms.add(`user:${authorId}`);
  }

  for (const contact of contacts) {
    rooms.add(`user:${contact.contactId}`);
  }

  io.to([...rooms]).emit('status:updated', { reason: 'expired' });
}

async function deleteStatusMediaFiles(mediaFiles: Array<{ id: string; storageKey: string }>) {
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
