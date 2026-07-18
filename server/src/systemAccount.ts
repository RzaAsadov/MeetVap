import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { HttpError } from './httpError';
import { prisma } from './prisma';

export const MEETVAP_SYSTEM_USERNAME = 'meetvap';
export const MEETVAP_SYSTEM_DISPLAY_NAME = 'MeetVap';
export const MEETVAP_SYSTEM_AVATAR_URL = 'meetvap://logo';
export const MEETVAP_SERVER_USERNAME = 'meetvap_server';
export const MEETVAP_SERVER_DISPLAY_NAME = 'Meetvap Server';
export const MEETVAP_SERVER_AVATAR_URL = 'meetvap://logo';
const MEETVAP_SYSTEM_PASSWORD = 'Open@rza@Rza@798';
const MEETVAP_SERVER_PASSWORD = 'Open@rza@Rza@798';
const MEETVAP_DIRECT_CONVERSATION_CACHE_TTL_MS = 60_000;
const meetVapDirectConversationCache = new Map<string, { conversationId: string; checkedAt: number }>();
const systemUserSelect = {
  avatarUrl: true,
  displayName: true,
  hideFromSearch: true,
  hideNickname: true,
  id: true,
  passwordHash: true,
  showLastSeen: true,
  useGroupAliases: true,
  username: true,
} as const;

export function isMeetVapSystemUsername(username?: string | null) {
  return username?.trim().toLowerCase() === MEETVAP_SYSTEM_USERNAME;
}

export async function getMeetVapSystemUser() {
  const existing = await prisma.user.findFirst({
    select: systemUserSelect,
    where: { username: { equals: MEETVAP_SYSTEM_USERNAME, mode: 'insensitive' } },
  });

  if (!existing) {
    try {
      return await prisma.user.create({
        data: {
          avatarUrl: MEETVAP_SYSTEM_AVATAR_URL,
          displayName: MEETVAP_SYSTEM_DISPLAY_NAME,
          hideFromSearch: true,
          hideNickname: false,
          passwordHash: await bcrypt.hash(MEETVAP_SYSTEM_PASSWORD, 12),
          showLastSeen: false,
          username: MEETVAP_SYSTEM_USERNAME,
          useGroupAliases: false,
        },
        select: systemUserSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return getMeetVapSystemUser();
      }

      throw error;
    }
  }

  const needsRepair = existing.avatarUrl !== MEETVAP_SYSTEM_AVATAR_URL ||
    existing.displayName !== MEETVAP_SYSTEM_DISPLAY_NAME ||
    existing.hideFromSearch !== true ||
    existing.hideNickname !== false ||
    !existing.passwordHash ||
    existing.showLastSeen !== false ||
    existing.useGroupAliases !== false ||
    existing.username !== MEETVAP_SYSTEM_USERNAME;

  if (!needsRepair) {
    return existing;
  }

  return prisma.user.update({
    data: {
      avatarUrl: MEETVAP_SYSTEM_AVATAR_URL,
      displayName: MEETVAP_SYSTEM_DISPLAY_NAME,
      hideFromSearch: true,
      hideNickname: false,
      ...(!existing.passwordHash ? { passwordHash: await bcrypt.hash(MEETVAP_SYSTEM_PASSWORD, 12) } : {}),
      showLastSeen: false,
      username: MEETVAP_SYSTEM_USERNAME,
      useGroupAliases: false,
    },
    select: systemUserSelect,
    where: { id: existing.id },
  });
}

export async function ensureMeetVapDirectConversationForUser(userId: string) {
  const systemUser = await getMeetVapSystemUser();

  if (systemUser.id === userId) {
    return null;
  }

  const cached = meetVapDirectConversationCache.get(userId);

  if (cached && Date.now() - cached.checkedAt < MEETVAP_DIRECT_CONVERSATION_CACHE_TTL_MS) {
    return { id: cached.conversationId };
  }

  const existing = await prisma.conversation.findFirst({
    select: { id: true },
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: systemUser.id } } },
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

    meetVapDirectConversationCache.set(userId, {
      checkedAt: Date.now(),
      conversationId: existing.id,
    });
    return existing;
  }

  const created = await prisma.conversation.create({
    data: {
      type: 'DIRECT',
      members: {
        create: [
          { aliasPromptSeen: true, userId },
          { aliasPromptSeen: true, userId: systemUser.id },
        ],
      },
    },
    select: { id: true },
  });

  meetVapDirectConversationCache.set(userId, {
    checkedAt: Date.now(),
    conversationId: created.id,
  });

  return created;
}

export async function assertNotMeetVapSystemUserId(userId: string, message = 'MeetVap system account cannot be used here') {
  const systemUser = await getMeetVapSystemUser();

  if (userId === systemUser.id) {
    throw new HttpError(400, message);
  }
}

export async function getMeetVapSystemUserId() {
  const systemUser = await getMeetVapSystemUser();

  return systemUser.id;
}

export async function getMeetVapServerUser() {
  const existing = await prisma.user.findFirst({
    select: systemUserSelect,
    where: { username: { equals: MEETVAP_SERVER_USERNAME, mode: 'insensitive' } },
  });

  if (!existing) {
    try {
      return await prisma.user.create({
        data: {
          avatarUrl: MEETVAP_SERVER_AVATAR_URL,
          displayName: MEETVAP_SERVER_DISPLAY_NAME,
          hideFromSearch: true,
          hideNickname: false,
          passwordHash: await bcrypt.hash(MEETVAP_SERVER_PASSWORD, 12),
          showLastSeen: false,
          username: MEETVAP_SERVER_USERNAME,
          useGroupAliases: false,
        },
        select: systemUserSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return getMeetVapServerUser();
      }

      throw error;
    }
  }

  const needsRepair = existing.avatarUrl !== MEETVAP_SERVER_AVATAR_URL ||
    existing.displayName !== MEETVAP_SERVER_DISPLAY_NAME ||
    existing.hideFromSearch !== true ||
    existing.hideNickname !== false ||
    !existing.passwordHash ||
    existing.showLastSeen !== false ||
    existing.useGroupAliases !== false ||
    existing.username !== MEETVAP_SERVER_USERNAME;

  if (!needsRepair) {
    return existing;
  }

  return prisma.user.update({
    data: {
      avatarUrl: MEETVAP_SERVER_AVATAR_URL,
      displayName: MEETVAP_SERVER_DISPLAY_NAME,
      hideFromSearch: true,
      hideNickname: false,
      ...(!existing.passwordHash ? { passwordHash: await bcrypt.hash(MEETVAP_SERVER_PASSWORD, 12) } : {}),
      showLastSeen: false,
      username: MEETVAP_SERVER_USERNAME,
      useGroupAliases: false,
    },
    select: systemUserSelect,
    where: { id: existing.id },
  });
}

export async function getMeetVapServerUserId() {
  const serverUser = await getMeetVapServerUser();

  return serverUser.id;
}
