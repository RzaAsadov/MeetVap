import { NextFunction, Request, Response, Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

import { getAuthedUser, hashPassword, invalidateUserAuthCache, requireAuth, verifyPassword } from '../auth';
import { getAvatarMediaId, isAvatarMediaReferenced } from '../avatarMedia';
import { getClientMetadataWriteData, getRequestClientMetadata } from '../clientCompatibility';
import { config } from '../config';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { invalidatePushTokenCacheForUser } from '../pushTokenCache';
import { serializeUser } from '../serializers';
import { ensureUserPublicShareCode } from '../shareCodes';
import { getPremiumFeatureAccessMap, requirePremiumFeatureAccess } from '../subscriptions';
import { getMeetVapSystemUserId } from '../systemAccount';
import { deleteAccountSchema, registerPushTokenSchema, updateAvatarSchema, updatePasswordSchema, updatePrivacySchema, updateProfileSchema, userRelationshipSchema, userSearchSchema } from '../validators';

export const userRoutes = Router();
const uploadDir = path.resolve(config.UPLOAD_DIR);
const diagnosticDataDir = path.resolve(process.cwd(), 'diagdata');
const rootConfigPaths = [
  path.resolve(__dirname, '../../../config.json'),
  path.resolve(process.cwd(), '../config.json'),
  path.resolve(process.cwd(), 'config.json'),
];
let cachedDefaultCatalogUrl: { loadedAt: number; url: string | null } | null = null;
let cachedDefaultHelpUrl: { loadedAt: number; url: string | null } | null = null;

function normalizeExternalUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const externalUrl = value.trim();
  if (!externalUrl) {
    return null;
  }

  try {
    const parsed = new URL(externalUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeCatalogUrl(value: unknown) {
  return normalizeExternalUrl(value);
}

function normalizeHelpUrl(value: unknown) {
  return normalizeExternalUrl(value);
}

async function getDefaultCatalogUrl() {
  if (cachedDefaultCatalogUrl && Date.now() - cachedDefaultCatalogUrl.loadedAt < 10_000) {
    return cachedDefaultCatalogUrl.url;
  }

  let url: string | null = null;

  for (const rootConfigPath of rootConfigPaths) {
    try {
      const rawConfig = await fs.readFile(rootConfigPath, 'utf8');
      const parsedConfig = JSON.parse(rawConfig) as { catalog?: { url?: unknown } };
      url = normalizeCatalogUrl(parsedConfig.catalog?.url);
      break;
    } catch {
      url = null;
    }
  }

  cachedDefaultCatalogUrl = { loadedAt: Date.now(), url };
  return url;
}

async function getDefaultHelpUrl() {
  if (cachedDefaultHelpUrl && Date.now() - cachedDefaultHelpUrl.loadedAt < 10_000) {
    return cachedDefaultHelpUrl.url;
  }

  let url: string | null = null;

  for (const rootConfigPath of rootConfigPaths) {
    try {
      const rawConfig = await fs.readFile(rootConfigPath, 'utf8');
      const parsedConfig = JSON.parse(rawConfig) as { help?: { url?: unknown } };
      url = normalizeHelpUrl(parsedConfig.help?.url);
      break;
    } catch {
      url = null;
    }
  }

  cachedDefaultHelpUrl = { loadedAt: Date.now(), url };
  return url;
}

async function getUserCatalogUrl(userId: string) {
  const columns = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'User'
        and column_name = 'catalogUrl'
    ) as "exists"
  `;

  if (!columns[0]?.exists) {
    return null;
  }

  const rows = await prisma.$queryRaw<Array<{ catalogUrl: string | null }>>`
    select "catalogUrl" as "catalogUrl"
    from "User"
    where id = ${userId}
    limit 1
  `;

  return normalizeCatalogUrl(rows[0]?.catalogUrl);
}

async function hasUserDiagnosticModeColumn() {
  const columns = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'User'
        and column_name = 'diagnosticMode'
    ) as "exists"
  `;

  return columns[0]?.exists === true;
}

async function getUserDiagnosticMode(userId: string) {
  if (!await hasUserDiagnosticModeColumn()) {
    return false;
  }

  const rows = await prisma.$queryRaw<Array<{ diagnosticMode: boolean }>>`
    select "diagnosticMode" as "diagnosticMode"
    from "User"
    where id = ${userId}
    limit 1
  `;

  return rows[0]?.diagnosticMode === true;
}

async function getUserCallDiagnosticMode(userId: string) {
  const columns = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'User'
        and column_name = 'callDiagnosticMode'
    ) as "exists"
  `;

  if (!columns[0]?.exists) {
    return false;
  }

  const rows = await prisma.$queryRaw<Array<{ callDiagnosticMode: boolean }>>`
    select "callDiagnosticMode" as "callDiagnosticMode"
    from "User"
    where id = ${userId}
    limit 1
  `;

  return rows[0]?.callDiagnosticMode === true;
}

async function attachPremiumAccessToUsers<T extends { hasPremiumAccess?: boolean; id: string }>(users: T[]) {
  const premiumAccessByUserId = await getPremiumFeatureAccessMap(users.map((user) => user.id));

  users.forEach((user) => {
    user.hasPremiumAccess = premiumAccessByUserId.get(user.id) === true;
  });
}

async function serializeCurrentUserForOwner(user: {
  avatarUrl: string | null;
  displayName: string;
  hideFromSearch: boolean;
  hideNickname: boolean;
  id: string;
  lastSeenAt: Date;
  onlyContactsCanCall: boolean;
  showLastSeen: boolean;
  useGroupAliases: boolean;
  username: string;
}, preventPeerScreenshots?: boolean) {
  return {
    ...serializeUser({ ...user, publicShareCode: await ensureUserPublicShareCode(user.id) }, { revealNickname: true }),
    preventPeerScreenshots: preventPeerScreenshots ?? await getPreventPeerScreenshots(user.id),
  };
}

function emitCurrentUserUpdated(req: Request, user: Awaited<ReturnType<typeof serializeCurrentUserForOwner>>) {
  req.app.get('io')?.to(`user:${user.id}`).emit('user:updated', { user });
}

function sanitizeDiagnosticPathSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'unknown';
}

function normalizeDiagnosticEntry(entry: unknown, req: Request) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const event = typeof record.event === 'string' ? record.event.slice(0, 120) : 'unknown';
  const at = typeof record.at === 'string' && !Number.isNaN(Date.parse(record.at))
    ? record.at
    : new Date().toISOString();
  const details = record.details && typeof record.details === 'object'
    ? sanitizeDiagnosticValue(record.details, 0)
    : {};
  const scope = record.scope === 'call' ? 'call' : 'message';

  return {
    at,
    event,
    details,
    scope,
    receivedAt: new Date().toISOString(),
    client: {
      build: req.header('X-MeetVap-Build-Number') ?? req.header('X-MeetVap-Build') ?? null,
      capabilities: req.header('X-MeetVap-Capabilities') ?? null,
      platform: req.header('X-MeetVap-Platform') ?? null,
      version: req.header('X-MeetVap-App-Version') ?? req.header('X-MeetVap-Version') ?? null,
    },
    request: {
      ip: req.ip,
      userAgent: req.header('User-Agent') ?? null,
    },
  };
}

function sanitizeDiagnosticValue(value: unknown, depth: number): unknown {
  if (depth > 6) {
    return '[depth-limit]';
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated]` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, nestedValue]) => {
      sanitized[key.slice(0, 120)] = sanitizeDiagnosticValue(nestedValue, depth + 1);
    });
    return sanitized;
  }

  return String(value);
}

async function updateCurrentUserAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateAvatarSchema.parse(req.body);
    const previousAvatarMediaId = getAvatarMediaId(currentUser.avatarUrl);
    const nextAvatarMediaId = getAvatarMediaId(input.avatarUrl);
    const user = await prisma.user.update({
      data: { avatarUrl: input.avatarUrl },
      select: {
        avatarUrl: true,
        displayName: true,
        hideFromSearch: true,
        hideNickname: true,
        id: true,
        lastSeenAt: true,
        onlyContactsCanCall: true,
        showLastSeen: true,
        useGroupAliases: true,
        username: true,
      },
      where: { id: currentUser.id },
    });

    await deleteAvatarMediaIfUnused(previousAvatarMediaId, nextAvatarMediaId);

    const memberships = await prisma.conversationMember.findMany({
      select: {
        conversation: {
          select: {
            members: {
              select: { userId: true },
            },
          },
        },
        conversationId: true,
      },
      where: { userId: currentUser.id },
    });
    const io = req.app.get('io');

    memberships.forEach((membership) => {
      const memberRooms = membership.conversation.members.map((member) => `user:${member.userId}`);
      io?.to(memberRooms).emit('conversation:updated', { conversationId: membership.conversationId });
    });

    const serializedUser = await serializeCurrentUserForOwner(user);

    emitCurrentUserUpdated(req, serializedUser);
    res.json({ user: serializedUser });
  } catch (error) {
    next(error);
  }
}

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

userRoutes.patch('/me/avatar', requireAuth, updateCurrentUserAvatar);
userRoutes.post('/me/avatar', requireAuth, updateCurrentUserAvatar);

userRoutes.get('/me/catalog', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    let userCatalogUrl: string | null = null;

    try {
      userCatalogUrl = await getUserCatalogUrl(currentUser.id);
    } catch (error) {
      console.warn('Catalog URL user override lookup failed; falling back to server config', error);
    }

    const catalogUrl = userCatalogUrl ?? await getDefaultCatalogUrl();

    res.json({ catalogUrl });
  } catch (error) {
    next(error);
  }
});

userRoutes.get('/me/help', requireAuth, async (_req, res, next) => {
  try {
    const helpUrl = await getDefaultHelpUrl();

    res.json({ helpUrl });
  } catch (error) {
    next(error);
  }
});

userRoutes.get('/me/diagnostics', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const [messageEnabled, callEnabled] = await Promise.all([
      getUserDiagnosticMode(currentUser.id),
      getUserCallDiagnosticMode(currentUser.id),
    ]);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
      // Keep the original field for clients released before scoped diagnostics.
      enabled: messageEnabled,
      messageEnabled,
      callEnabled,
      maxBatchSize: 80,
      uploadIntervalSeconds: 5,
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.post('/me/diagnostics', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const [messageEnabled, callEnabled] = await Promise.all([
      getUserDiagnosticMode(currentUser.id),
      getUserCallDiagnosticMode(currentUser.id),
    ]);

    if (!messageEnabled && !callEnabled) {
      res.json({ accepted: false, stored: 0 });
      return;
    }

    const entries: unknown[] = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 100) : [];
    const storedEntries = entries
      .map((entry) => normalizeDiagnosticEntry(entry, req))
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeDiagnosticEntry>> => (
        !!entry && (entry.scope === 'call' ? callEnabled : messageEnabled)
      ));

    if (storedEntries.length === 0) {
      res.json({ accepted: true, stored: 0 });
      return;
    }

    const safeUserId = sanitizeDiagnosticPathSegment(currentUser.id);
    const userDiagnosticDir = path.join(diagnosticDataDir, safeUserId);
    const logFileName = `${new Date().toISOString().slice(0, 10)}.log`;
    const logFilePath = path.join(userDiagnosticDir, logFileName);
    const lines = storedEntries
      .map((entry) => JSON.stringify(entry))
      .join('\n');

    await fs.mkdir(userDiagnosticDir, { recursive: true });
    await fs.appendFile(logFilePath, `${lines}\n`, 'utf8');

    res.json({ accepted: true, stored: storedEntries.length });
  } catch (error) {
    next(error);
  }
});

userRoutes.patch('/me/profile', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updateProfileSchema.parse(req.body);
    const profileUpdate: { displayName?: string; username?: string } = {};

    if (input.displayName !== undefined) {
      profileUpdate.displayName = input.displayName;
    }

    if (input.username !== undefined) {
      const existingUser = await prisma.user.findFirst({
        select: { id: true },
        where: {
          id: { not: currentUser.id },
          username: input.username,
        },
      });

      if (existingUser) {
        throw new HttpError(409, 'Nickname is already taken');
      }

      profileUpdate.username = input.username;
    }

    const user = await prisma.user.update({
      data: profileUpdate,
      select: {
        avatarUrl: true,
        displayName: true,
        hideFromSearch: true,
        hideNickname: true,
        id: true,
        lastSeenAt: true,
        onlyContactsCanCall: true,
        showLastSeen: true,
        useGroupAliases: true,
        username: true,
      },
      where: { id: currentUser.id },
    });
    const memberships = await prisma.conversationMember.findMany({
      select: {
        conversation: {
          select: {
            members: {
              select: { userId: true },
            },
          },
        },
        conversationId: true,
      },
      where: { userId: currentUser.id },
    });
    const io = req.app.get('io');

    memberships.forEach((membership) => {
      const memberRooms = membership.conversation.members.map((member) => `user:${member.userId}`);
      io?.to(memberRooms).emit('conversation:updated', { conversationId: membership.conversationId });
    });

    const serializedUser = await serializeCurrentUserForOwner(user);

    emitCurrentUserUpdated(req, serializedUser);
    res.json({ user: serializedUser });
  } catch (error) {
    next(error);
  }
});

userRoutes.patch('/me/password', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updatePasswordSchema.parse(req.body);
    const account = await prisma.user.findUnique({
      select: {
        id: true,
        passwordHash: true,
      },
      where: { id: currentUser.id },
    });

    if (!account?.passwordHash || !(await verifyPassword(input.currentPassword, account.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect');
    }

    await prisma.user.update({
      data: { passwordHash: await hashPassword(input.newPassword) },
      where: { id: currentUser.id },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

userRoutes.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = deleteAccountSchema.parse(req.body);
    const account = await prisma.user.findUnique({
      select: {
        id: true,
        passwordHash: true,
      },
      where: { id: currentUser.id },
    });

    if (!account?.passwordHash || !(await verifyPassword(input.password, account.passwordHash))) {
      throw new HttpError(401, 'Password is incorrect');
    }

    const ownedMedia = await prisma.mediaFile.findMany({
      select: { storageKey: true },
      where: { ownerId: currentUser.id },
    });
    const memberships = await prisma.conversationMember.findMany({
      select: {
        conversation: {
          select: {
            members: {
              select: { userId: true },
            },
          },
        },
        conversationId: true,
      },
      where: { userId: currentUser.id },
    });

    await prisma.user.delete({ where: { id: currentUser.id } });
    await Promise.allSettled(
      ownedMedia.map((media) => fs.unlink(path.join(uploadDir, media.storageKey))),
    );

    const io = req.app.get('io');
    memberships.forEach((membership) => {
      const memberRooms = membership.conversation.members
        .filter((member) => member.userId !== currentUser.id)
        .map((member) => `user:${member.userId}`);
      io?.to(memberRooms).emit('conversation:updated', { conversationId: membership.conversationId });
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

userRoutes.patch('/me/privacy', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = updatePrivacySchema.parse(req.body);
    const privacyUpdate: { hideFromSearch?: boolean; hideNickname?: boolean; onlyContactsCanCall?: boolean; showLastSeen?: boolean; useGroupAliases?: boolean } = {};

    if (input.hideFromSearch !== undefined) {
      privacyUpdate.hideFromSearch = input.hideFromSearch;
    }

    if (input.hideNickname !== undefined) {
      privacyUpdate.hideNickname = input.hideNickname;
    }

    if (input.onlyContactsCanCall !== undefined) {
      privacyUpdate.onlyContactsCanCall = input.onlyContactsCanCall;
    }

    if (input.showLastSeen !== undefined) {
      privacyUpdate.showLastSeen = input.showLastSeen;
    }

    if (input.useGroupAliases === true) {
      await requirePremiumFeatureAccess(currentUser.id);
    }

    if (input.useGroupAliases !== undefined) {
      privacyUpdate.useGroupAliases = input.useGroupAliases;
    }

    if (input.preventPeerScreenshots === true) {
      await requirePremiumFeatureAccess(currentUser.id);
    }

    if (input.preventPeerScreenshots !== undefined) {
      await prisma.$executeRaw`
        update "User"
        set "preventPeerScreenshots" = ${input.preventPeerScreenshots}
        where "id" = ${currentUser.id}
      `;
    }

    const user = Object.keys(privacyUpdate).length > 0
      ? await prisma.user.update({
          data: privacyUpdate,
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            onlyContactsCanCall: true,
            showLastSeen: true,
            useGroupAliases: true,
            username: true,
          },
          where: { id: currentUser.id },
        })
      : await prisma.user.findUniqueOrThrow({
          select: {
            avatarUrl: true,
            displayName: true,
            hideFromSearch: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            onlyContactsCanCall: true,
            showLastSeen: true,
            useGroupAliases: true,
            username: true,
          },
          where: { id: currentUser.id },
        });

    if (input.useGroupAliases === false) {
      await prisma.conversationMember.updateMany({
        data: {
          aliasName: null,
          aliasPromptSeen: false,
        },
        where: { userId: currentUser.id },
      });
      const memberships = await prisma.conversationMember.findMany({
        select: {
          conversation: {
            select: {
              members: {
                select: { userId: true },
              },
            },
          },
          conversationId: true,
        },
        where: { userId: currentUser.id },
      });

      memberships.forEach((membership) => {
        const memberRooms = membership.conversation.members.map((member) => `user:${member.userId}`);
        req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: membership.conversationId });
      });
    }

    if (input.showLastSeen !== undefined) {
      req.app.get('io')?.to(`user:${currentUser.id}`).emit('presence:privacy', {
        showLastSeen: user.showLastSeen,
        userId: user.id,
      });
      const memberships = await prisma.conversationMember.findMany({
        select: {
          conversation: {
            select: {
              members: {
                select: { userId: true },
              },
            },
          },
        },
        where: { userId: currentUser.id },
      });
      const memberRooms = new Set<string>();

      memberships.forEach((membership) => {
        membership.conversation.members.forEach((member) => {
          if (member.userId !== currentUser.id) {
            memberRooms.add(`user:${member.userId}`);
          }
        });
      });

      req.app.get('io')?.to([...memberRooms]).emit('presence:update', {
        isOnline: user.showLastSeen,
        lastSeenAt: user.showLastSeen ? user.lastSeenAt.toISOString() : null,
        showLastSeen: user.showLastSeen,
        userId: user.id,
      });
    }

    if (input.hideNickname !== undefined) {
      const memberships = await prisma.conversationMember.findMany({
        select: {
          conversation: {
            select: {
              members: {
                select: { userId: true },
              },
            },
          },
          conversationId: true,
        },
        where: { userId: currentUser.id },
      });

      memberships.forEach((membership) => {
        const memberRooms = membership.conversation.members.map((member) => `user:${member.userId}`);
        req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: membership.conversationId });
      });
    }

    const serializedUser = await serializeCurrentUserForOwner(user, input.preventPeerScreenshots);

    await invalidateUserAuthCache(currentUser.id);
    emitCurrentUserUpdated(req, serializedUser);
    res.json({ user: serializedUser });
  } catch (error) {
    next(error);
  }
});

userRoutes.post('/push-token', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = registerPushTokenSchema.parse(req.body);
    const provider = normalizePushTokenProvider(input.provider, input.platform);
    const clientMetadata = getRequestClientMetadata(req, input.platform);

    await prisma.devicePushToken.upsert({
      create: {
        ...getClientMetadataWriteData(clientMetadata),
        locale: input.locale,
        platform: input.platform,
        provider,
        token: input.token,
        userId: currentUser.id,
      },
      update: {
        ...getClientMetadataWriteData(clientMetadata),
        locale: input.locale,
        platform: input.platform,
        provider,
        userId: currentUser.id,
      },
      where: { token: input.token },
    });
    await invalidatePushTokenCacheForUser(currentUser.id);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function normalizePushTokenProvider(provider: string, platform?: string) {
  if (platform === 'ios' && provider === 'fcm') {
    return 'apns';
  }

  return provider;
}

userRoutes.get('/search', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = userSearchSchema.parse(req.query);
    const blocks = await prisma.userBlock.findMany({
      select: {
        blockedId: true,
        blockerId: true,
      },
      where: {
        OR: [
          { blockerId: currentUser.id },
          { blockedId: currentUser.id },
        ],
      },
    });
    const blockedUserIds = new Set(blocks.map((block) => (
      block.blockerId === currentUser.id ? block.blockedId : block.blockerId
    )));
    const users = await prisma.user.findMany({
      orderBy: { username: 'asc' },
      select: {
        avatarUrl: true,
        savedBy: {
          select: { ownerId: true },
          where: { ownerId: currentUser.id },
        },
        displayName: true,
        hideFromSearch: true,
        hideNickname: true,
        id: true,
        lastSeenAt: true,
        showLastSeen: true,
        username: true,
      },
      take: 20,
      where: {
        AND: [
          { id: { not: currentUser.id } },
          { hideFromSearch: false },
          {
            OR: [
              {
                AND: [
                  { hideNickname: false },
                  { username: { contains: input.q, mode: 'insensitive' } },
                ],
              },
              { displayName: { contains: input.q, mode: 'insensitive' } },
            ],
          },
        ],
      },
    });
    await attachPremiumAccessToUsers(users);

    res.json({
      users: users
        .filter((user) => !blockedUserIds.has(user.id))
        .map((user) => ({
          ...serializeUser(user),
          isContact: user.savedBy.length > 0,
          isBlocked: false,
        })),
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.get('/shared/:shareCode', async (req, res, next) => {
  try {
    const shareCode = String(req.params.shareCode ?? '').trim();

    if (!shareCode) {
      throw new HttpError(400, 'Share code is required');
    }

    const users = await prisma.$queryRaw<Array<{
      avatarUrl: string | null;
      displayName: string;
      id: string;
      publicShareCode: string | null;
    }>>`
      select "avatarUrl", "displayName", "id", "publicShareCode"
      from "User"
      where "publicShareCode" = ${shareCode}
      limit 1
    `;
    const user = users[0];

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    res.json({
      user: {
        avatarUrl: user.avatarUrl,
        displayName: user.displayName,
        id: user.id,
        isOnline: false,
        lastSeenAt: null,
        publicShareCode: user.publicShareCode,
        showLastSeen: false,
        username: '',
      },
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.get('/contacts', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const contacts = await prisma.contact.findMany({
      include: {
        contact: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      where: { ownerId: currentUser.id },
    });
    const publicShareCodes = new Map(
      await Promise.all(contacts.map(async (contact) => [
        contact.contact.id,
        await ensureUserPublicShareCode(contact.contact.id),
      ] as const)),
    );
    await attachPremiumAccessToUsers(contacts.map((contact) => contact.contact));

    res.json({
      contacts: contacts.map((contact) => serializeUser({
        ...contact.contact,
        publicShareCode: publicShareCodes.get(contact.contact.id) ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.post('/contacts', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = userRelationshipSchema.parse(req.body);

    if (input.userId === currentUser.id) {
      throw new HttpError(400, 'Cannot add yourself as a contact');
    }

    if (input.userId === await getMeetVapSystemUserId()) {
      throw new HttpError(400, 'MeetVap system account cannot be added to contacts');
    }

    await assertUserExists(input.userId);
    await assertNotBlockedBetween(currentUser.id, input.userId);

    const contact = await prisma.contact.upsert({
      create: {
        contactId: input.userId,
        ownerId: currentUser.id,
      },
      include: {
        contact: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      update: {},
      where: {
        ownerId_contactId: {
          contactId: input.userId,
          ownerId: currentUser.id,
        },
      },
    });
    const publicShareCode = await ensureUserPublicShareCode(contact.contact.id);
    await attachPremiumAccessToUsers([contact.contact]);

    res.status(201).json({ contact: serializeUser({ ...contact.contact, publicShareCode }) });
  } catch (error) {
    next(error);
  }
});

userRoutes.delete('/contacts/:userId', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const userId = String(req.params.userId);

    await prisma.contact.deleteMany({
      where: {
        contactId: userId,
        ownerId: currentUser.id,
      },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

userRoutes.get('/blocks', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const blocks = await prisma.userBlock.findMany({
      include: {
        blocked: {
          select: {
            avatarUrl: true,
            displayName: true,
            hideNickname: true,
            id: true,
            lastSeenAt: true,
            showLastSeen: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      where: { blockerId: currentUser.id },
    });
    await attachPremiumAccessToUsers(blocks.map((block) => block.blocked));

    res.json({ blockedUsers: blocks.map((block) => serializeUser(block.blocked)) });
  } catch (error) {
    next(error);
  }
});

userRoutes.post('/blocks', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = userRelationshipSchema.parse(req.body);

    if (input.userId === currentUser.id) {
      throw new HttpError(400, 'Cannot block yourself');
    }

    if (input.userId === await getMeetVapSystemUserId()) {
      throw new HttpError(400, 'MeetVap system account cannot be blocked');
    }

    await assertUserExists(input.userId);
    await prisma.$transaction([
      prisma.contact.deleteMany({
        where: {
          OR: [
            { contactId: input.userId, ownerId: currentUser.id },
            { contactId: currentUser.id, ownerId: input.userId },
          ],
        },
      }),
      prisma.userBlock.upsert({
        create: {
          blockedId: input.userId,
          blockerId: currentUser.id,
        },
        update: {},
        where: {
          blockerId_blockedId: {
            blockedId: input.userId,
            blockerId: currentUser.id,
          },
        },
      }),
    ]);

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

userRoutes.delete('/blocks/:userId', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const userId = String(req.params.userId);

    await prisma.userBlock.deleteMany({
      where: {
        blockedId: userId,
        blockerId: currentUser.id,
      },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function assertUserExists(userId: string) {
  const user = await prisma.user.findUnique({
    select: { id: true },
    where: { id: userId },
  });

  if (!user) {
    throw new HttpError(404, 'User not found');
  }
}

async function getPreventPeerScreenshots(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ preventPeerScreenshots: boolean }>>`
    select "preventPeerScreenshots" from "User" where "id" = ${userId} limit 1
  `;

  return rows[0]?.preventPeerScreenshots !== false;
}

export async function assertNotBlockedBetween(firstUserId: string, secondUserId: string) {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockedId: secondUserId, blockerId: firstUserId },
        { blockedId: firstUserId, blockerId: secondUserId },
      ],
    },
  });

  if (block) {
    throw new HttpError(403, 'User is blocked');
  }
}
