import { prisma } from './prisma';

const MEDIA_FILE_PATH_PATTERN = /^\/media\/([^/]+)\/file$/;

export function getAvatarMediaId(avatarUrl?: string | null) {
  if (!avatarUrl) {
    return null;
  }

  if (avatarUrl.startsWith('/media/')) {
    const match = MEDIA_FILE_PATH_PATTERN.exec(avatarUrl);
    return match?.[1] ?? null;
  }

  try {
    const parsed = new URL(avatarUrl);
    const match = MEDIA_FILE_PATH_PATTERN.exec(parsed.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function listReferencedAvatarMediaIds() {
  const [users, conversations] = await Promise.all([
    prisma.user.findMany({
      select: { avatarUrl: true },
      where: { avatarUrl: { not: null } },
    }),
    prisma.conversation.findMany({
      select: { avatarUrl: true },
      where: { avatarUrl: { not: null } },
    }),
  ]);

  const ids = new Set<string>();

  for (const row of [...users, ...conversations]) {
    const mediaId = getAvatarMediaId(row.avatarUrl);
    if (mediaId) {
      ids.add(mediaId);
    }
  }

  return [...ids];
}

export async function isAvatarMediaReferenced(mediaId: string) {
  const [users, conversations] = await Promise.all([
    prisma.user.findFirst({
      select: { id: true },
      where: {
        avatarUrl: {
          contains: `/media/${mediaId}/file`,
        },
      },
    }),
    prisma.conversation.findFirst({
      select: { id: true },
      where: {
        avatarUrl: {
          contains: `/media/${mediaId}/file`,
        },
      },
    }),
  ]);

  return !!users || !!conversations;
}
