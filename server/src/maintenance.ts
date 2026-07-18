import fs from 'fs/promises';
import path from 'path';

import { Prisma } from '@prisma/client';

import { listReferencedAvatarMediaIds } from './avatarMedia';
import { config } from './config';
import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';
import { pruneRateLimitBuckets } from './rateLimits';
import { purgeAcknowledgedMessageContent } from './routes/conversationRoutes';

const uploadDir = path.resolve(config.UPLOAD_DIR);
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DATABASE_CLEANUP_BATCH_SIZE = 250;
const DATABASE_CLEANUP_MAX_BATCHES_PER_RUN = 4;
const PREVIEW_REFRESH_BATCH_SIZE = 25;
let activeOperationalCleanup: Promise<OperationalCleanupResult> | null = null;

export async function runOperationalCleanup() {
  if (activeOperationalCleanup) {
    return activeOperationalCleanup;
  }

  activeOperationalCleanup = performOperationalCleanup();

  try {
    return await activeOperationalCleanup;
  } finally {
    activeOperationalCleanup = null;
  }
}

async function performOperationalCleanup() {
  const startedAt = Date.now();
  const purgedMessageBodies = await cleanupPurgedMessageBodies();
  const expiredMessages = await cleanupExpiredQueueMessages();
  const messageStatusUpdates = await cleanupMessageStatusUpdates();
  const clientAckEligibleMessages = await cleanupClientAckEligibleMessages();
  const orphanMedia = await cleanupOrphanMedia();
  const partialUploads = await cleanupPartialUploads();
  const sessions = await cleanupExpiredSessions();
  const staleCalls = await cleanupStaleCalls();
  pruneRateLimitBuckets();

  const result = {
    durationMs: Date.now() - startedAt,
    expiredMessages,
    messageStatusUpdates,
    clientAckEligibleMessages,
    orphanMedia,
    partialUploads,
    purgedMessageBodies,
    sessions,
    staleCalls,
  };
  console.log('Operational cleanup completed', result);
  return result;
}

type OperationalCleanupResult = Awaited<ReturnType<typeof performOperationalCleanup>>;

async function cleanupPurgedMessageBodies() {
  const conversationIds = new Set<string>();
  let scrubbed = 0;
  let messages: Array<{ conversationId: string; id: string }>;
  let batchCount = 0;

  do {
    messages = await prisma.message.findMany({
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      select: { conversationId: true, id: true },
      take: DATABASE_CLEANUP_BATCH_SIZE,
      where: {
        body: { not: '' },
        contentPurgedAt: { not: null },
        kind: { not: 'CALL' },
      },
    });

    if (messages.length === 0) {
      break;
    }

    messages.forEach((message) => conversationIds.add(message.conversationId));
    await prisma.message.updateMany({
      data: { body: '' },
      where: { id: { in: messages.map((message) => message.id) } },
    });
    scrubbed += messages.length;
    batchCount += 1;
  } while (messages.length === DATABASE_CLEANUP_BATCH_SIZE && batchCount < DATABASE_CLEANUP_MAX_BATCHES_PER_RUN);

  await processInBatches([...conversationIds], PREVIEW_REFRESH_BATCH_SIZE, refreshConversationPreview);
  return scrubbed;
}

async function cleanupExpiredQueueMessages() {
  const now = Date.now();
  const mediaCutoff = new Date(now - operationalConfig.retention.mediaMessageDays * DAY_MS);
  const locationCutoff = new Date(now - operationalConfig.retention.locationMessageDays * DAY_MS);
  const textCutoff = new Date(now - operationalConfig.retention.textMessageDays * DAY_MS);
  const conversationIds = new Set<string>();
  let removed = 0;
  let expired: ExpiredQueueMessage[];
  let batchCount = 0;

  do {
    expired = await prisma.$queryRaw<ExpiredQueueMessage[]>(Prisma.sql`
      select "conversationId", "id", "mediaId"
      from "Message"
      where
        ("createdAt" <= ${mediaCutoff} and "kind" in ('IMAGE', 'VIDEO', 'FILE', 'VOICE'))
        or ("createdAt" <= ${textCutoff} and "kind" = 'TEXT')
        or (
          "createdAt" <= ${locationCutoff}
          and "kind" = 'TEXT'
          and ("metadata" ? 'location' or "metadata" ? 'liveLocation')
        )
      order by "createdAt" asc, "id" asc
      limit ${DATABASE_CLEANUP_BATCH_SIZE}
    `);

    if (expired.length === 0) {
      break;
    }

    expired.forEach((message) => conversationIds.add(message.conversationId));
    await prisma.message.deleteMany({ where: { id: { in: expired.map((message) => message.id) } } });
    await deleteUnusedMedia(expired.flatMap((message) => message.mediaId ? [message.mediaId] : []));
    removed += expired.length;
    batchCount += 1;
  } while (expired.length === DATABASE_CLEANUP_BATCH_SIZE && batchCount < DATABASE_CLEANUP_MAX_BATCHES_PER_RUN);

  await processInBatches([...conversationIds], PREVIEW_REFRESH_BATCH_SIZE, refreshConversationPreview);
  return removed;
}

async function cleanupMessageStatusUpdates() {
  const readAckedCutoff = new Date(Date.now() - operationalConfig.maintenance.expiredSessionRetentionDays * DAY_MS);
  const deliveredOnlyCutoff = new Date(Date.now() - operationalConfig.retention.textMessageDays * DAY_MS);
  const deleteLimit = DATABASE_CLEANUP_BATCH_SIZE * DATABASE_CLEANUP_MAX_BATCHES_PER_RUN;
  const readAckedDeleted = await prisma.$executeRaw`
    delete from "MessageStatusUpdate"
    where id in (
      select id
      from "MessageStatusUpdate"
      where "readAckedAt" <= ${readAckedCutoff}
      order by "readAckedAt" asc, id asc
      limit ${deleteLimit}
    )
  `;
  const deliveredOnlyDeleted = await prisma.$executeRaw`
    delete from "MessageStatusUpdate"
    where id in (
      select id
      from "MessageStatusUpdate"
      where "deliveredAckedAt" <= ${deliveredOnlyCutoff}
        and "readAt" is null
      order by "deliveredAckedAt" asc, id asc
      limit ${Math.max(0, deleteLimit - readAckedDeleted)}
    )
  `;

  return readAckedDeleted + deliveredOnlyDeleted;
}

async function cleanupClientAckEligibleMessages() {
  const messages = await prisma.message.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: DATABASE_CLEANUP_BATCH_SIZE,
    where: {
      contentPurgedAt: null,
      deletedAt: null,
      OR: [
        { contentAcks: { some: {} } },
        { messageClientAcks: { some: {} } },
      ],
    },
  });

  if (messages.length === 0) {
    return 0;
  }

  await purgeAcknowledgedMessageContent(messages.map((message) => message.id));
  return messages.length;
}

type ExpiredQueueMessage = {
  conversationId: string;
  id: string;
  mediaId: string | null;
};

async function cleanupOrphanMedia() {
  const cutoff = new Date(Date.now() - operationalConfig.maintenance.orphanMediaRetentionHours * HOUR_MS);
  const referencedAvatarMediaIds = await listReferencedAvatarMediaIds();
  let media: Array<{ id: string; storageKey: string }>;
  let removed = 0;
  let batchCount = 0;

  do {
    media = await prisma.mediaFile.findMany({
      select: { id: true, storageKey: true },
      take: DATABASE_CLEANUP_BATCH_SIZE,
      where: {
        createdAt: { lte: cutoff },
        ...(referencedAvatarMediaIds.length > 0 ? { id: { notIn: referencedAvatarMediaIds } } : {}),
        messages: { none: {} },
      },
    });

    if (media.length === 0) {
      break;
    }

    await prisma.mediaFile.deleteMany({ where: { id: { in: media.map((item) => item.id) } } });
    await Promise.all(media.map((item) => removeStoredFile(item.storageKey)));
    removed += media.length;
    batchCount += 1;
  } while (media.length === DATABASE_CLEANUP_BATCH_SIZE && batchCount < DATABASE_CLEANUP_MAX_BATCHES_PER_RUN);

  return removed;
}

async function deleteUnusedMedia(mediaIds: string[]) {
  if (mediaIds.length === 0) {
    return;
  }

  const media = await prisma.mediaFile.findMany({
    select: { id: true, storageKey: true },
    where: {
      id: { in: mediaIds },
      messages: { none: {} },
    },
  });

  if (media.length === 0) {
    return;
  }

  await prisma.mediaFile.deleteMany({ where: { id: { in: media.map((item) => item.id) } } });
  await Promise.all(media.map((item) => removeStoredFile(item.storageKey)));
}

async function cleanupPartialUploads() {
  const chunksDir = path.resolve(uploadDir, '.chunks');
  const cutoff = Date.now() - operationalConfig.maintenance.partialUploadRetentionHours * HOUR_MS;
  let removed = 0;

  try {
    const users = await fs.readdir(chunksDir, { withFileTypes: true });

    for (const user of users) {
      if (!user.isDirectory()) {
        continue;
      }

      const userDir = path.resolve(chunksDir, user.name);
      const uploads = await fs.readdir(userDir, { withFileTypes: true });

      for (const upload of uploads) {
        if (!upload.isDirectory()) {
          continue;
        }

        const uploadDirPath = path.resolve(userDir, upload.name);
        const stats = await fs.stat(uploadDirPath);

        if (stats.mtimeMs <= cutoff) {
          await fs.rm(uploadDirPath, { force: true, recursive: true });
          removed += 1;
        }
      }

      if ((await fs.readdir(userDir)).length === 0) {
        await fs.rmdir(userDir).catch(() => undefined);
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  return removed;
}

async function cleanupExpiredSessions() {
  const cutoff = new Date(Date.now() - operationalConfig.maintenance.expiredSessionRetentionDays * DAY_MS);
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lte: cutoff } } });
  return result.count;
}

async function cleanupStaleCalls() {
  const cutoff = new Date(Date.now() - operationalConfig.maintenance.staleCallTimeoutHours * HOUR_MS);
  const calls = await prisma.call.findMany({
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: DATABASE_CLEANUP_BATCH_SIZE,
    where: {
      endedAt: null,
      startedAt: { lte: cutoff },
    },
  });

  if (calls.length === 0) {
    return 0;
  }

  const callIds = calls.map((call) => call.id);
  const endedAt = new Date();

  await prisma.$transaction([
    prisma.callParticipant.updateMany({
      data: { leftAt: endedAt },
      where: {
        callId: { in: callIds },
        leftAt: null,
      },
    }),
    prisma.call.updateMany({
      data: { endedAt },
      where: {
        endedAt: null,
        id: { in: callIds },
      },
    }),
  ]);

  return callIds.length;
}

async function refreshConversationPreview(conversationId: string) {
  const [conversation, latest] = await Promise.all([
    prisma.conversation.findUniqueOrThrow({ select: { createdAt: true }, where: { id: conversationId } }),
    prisma.message.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { body: true, createdAt: true, kind: true, senderId: true, status: true },
      where: { conversationId, deletedAt: null },
    }),
  ]);

  await prisma.conversation.update({
    data: latest
      ? {
          lastMessageAt: latest.createdAt,
          lastMessageBody: latest.body,
          lastMessageKind: latest.kind,
          lastMessageSenderId: latest.senderId,
          lastMessageStatus: latest.status,
          updatedAt: latest.createdAt,
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

async function removeStoredFile(storageKey: string) {
  const filePath = path.resolve(uploadDir, storageKey);

  if (filePath.startsWith(`${uploadDir}${path.sep}`)) {
    await fs.unlink(filePath).catch(() => undefined);
  }
}

async function processInBatches<T>(items: T[], batchSize: number, task: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(task));
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
