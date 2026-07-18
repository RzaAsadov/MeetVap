import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { Server as SocketServer } from 'socket.io';

import { getSocketMessageClientIdentity, recordUserClientActivity } from './clientActivity';
import { config } from './config';
import { hashAccessToken } from './clientCompatibility';
import { MASK_SOCKET_ARGS_KEY, MASK_SOCKET_AUTH_KEY, MASK_SOCKET_VERSION_KEY, MASK_VERSION, unmaskPayload } from './payloadMask';
import { prisma } from './prisma';
import { JwtPayload } from './types';

const onlineSocketsByUser = new Map<string, number>();
const foregroundSocketsByUser = new Map<string, number>();
const PRESENCE_RECIPIENT_CACHE_TTL_MS = 60_000;
const presenceRecipientRoomsByUser = new Map<string, { checkedAt: number; rooms: string[] }>();

export function isUserCurrentlyOnline(userId: string) {
  return (onlineSocketsByUser.get(userId) ?? 0) > 0;
}

export function isUserCurrentlyForeground(userId: string) {
  return (foregroundSocketsByUser.get(userId) ?? 0) > 0;
}

export function createSocketServer(server: Server) {
  const io = new SocketServer(server, {
    cors: {
      origin: config.CLIENT_ORIGIN === '*' ? true : config.CLIENT_ORIGIN,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = getSocketAuthToken(socket.handshake.auth, socket.handshake.headers.authorization?.toString());

      if (!token) {
        next(new Error('Missing token'));
        return;
      }

      const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
      if (payload.scope === 'web') {
        const session = await prisma.session.findFirst({
          select: { id: true },
          where: {
            expiresAt: { gt: new Date() },
            platform: 'WEB',
            tokenHash: hashAccessToken(token),
            userId: payload.sub,
          },
        });

        if (!session) {
          next(new Error('Web session expired'));
          return;
        }
      }
      const user = await prisma.user.findUnique({
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
        where: { id: payload.sub },
      });

      if (!user) {
        next(new Error('Invalid token'));
        return;
      }

      socket.data.user = user;
      socket.data.messageClient = getSocketMessageClientIdentity(
        payload.scope === 'web',
        socket.handshake.auth?.installationId ?? socket.handshake.headers['x-meetvap-installation-id'],
      );
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id as string;
    const messageClient = typeof socket.data.messageClient === 'string' ? socket.data.messageClient : 'MOBILE';
    const onlineCount = onlineSocketsByUser.get(userId) ?? 0;

    socket.use((packet, next) => {
      try {
        unmaskSocketPacket(packet);
        next();
      } catch {
        next(new Error('Invalid masked socket payload'));
      }
    });

    onlineSocketsByUser.set(userId, onlineCount + 1);
    socket.join(`user:${userId}`);
    socket.emit('presence:ready', { userId });
    void recordUserClientActivity(userId, messageClient);
    if (onlineCount === 0) {
      void prisma.user.update({
        data: { lastSeenAt: new Date() },
        where: { id: userId },
      }).then((user) => {
        void emitUserPresence(io, user.id, true, user.showLastSeen, user.lastSeenAt);
      }).catch(() => undefined);
    }

    socket.on('conversation:join', async (conversationId: string, ack?: (response: { ok: boolean; error?: string }) => void) => {
      const member = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
      });

      if (!member) {
        ack?.({ error: 'Conversation not found', ok: false });
        return;
      }

      socket.join(conversationId);
      ack?.({ ok: true });
    });

    socket.on('conversation:leave', (conversationId: string) => {
      socket.leave(conversationId);
    });

    socket.on('typing:start', (payload: { conversationId: string }) => {
      socket.to(payload.conversationId).emit('typing:start', {
        conversationId: payload.conversationId,
        userId,
      });
    });

    socket.on('typing:stop', (payload: { conversationId: string }) => {
      socket.to(payload.conversationId).emit('typing:stop', {
        conversationId: payload.conversationId,
        userId,
      });
    });

    socket.on('call:invite', (payload: { conversationId: string; mode: 'VOICE' | 'VIDEO' }) => {
      socket.to(payload.conversationId).emit('call:invite', {
        conversationId: payload.conversationId,
        fromUserId: userId,
        mode: payload.mode,
      });
    });

    socket.on('app:state', (payload: { isForeground?: boolean; state?: string } | undefined) => {
      const isForeground = payload?.isForeground === true || payload?.state === 'active';
      updateSocketForegroundState(socket, userId, isForeground);
    });

    socket.on('disconnect', () => {
      updateSocketForegroundState(socket, userId, false);

      const currentCount = onlineSocketsByUser.get(userId) ?? 1;
      const nextCount = Math.max(0, currentCount - 1);

      if (nextCount > 0) {
        onlineSocketsByUser.set(userId, nextCount);
        return;
      }

      onlineSocketsByUser.delete(userId);
      void prisma.user.update({
        data: { lastSeenAt: new Date() },
        where: { id: userId },
      }).then((user) => {
        void emitUserPresence(io, user.id, false, user.showLastSeen, user.lastSeenAt);
      }).catch(() => undefined);
    });
  });

  return io;
}

function updateSocketForegroundState(socket: { data: Record<string, unknown> }, userId: string, isForeground: boolean) {
  const wasForeground = socket.data.isForeground === true;

  if (wasForeground === isForeground) {
    return;
  }

  socket.data.isForeground = isForeground;

  if (isForeground) {
    foregroundSocketsByUser.set(userId, (foregroundSocketsByUser.get(userId) ?? 0) + 1);
    return;
  }

  const nextCount = Math.max(0, (foregroundSocketsByUser.get(userId) ?? 1) - 1);

  if (nextCount > 0) {
    foregroundSocketsByUser.set(userId, nextCount);
    return;
  }

  foregroundSocketsByUser.delete(userId);
}

function getSocketAuthToken(auth: Record<string, unknown>, authorization?: string) {
  if (auth[MASK_SOCKET_VERSION_KEY] === MASK_VERSION && typeof auth[MASK_SOCKET_AUTH_KEY] === 'string') {
    const payload = unmaskPayload<{ token?: string }>(auth[MASK_SOCKET_AUTH_KEY]);

    return payload.token;
  }

  return typeof auth.token === 'string'
    ? auth.token
    : authorization?.replace(/^Bearer\s+/i, '');
}

function unmaskSocketPacket(packet: unknown[]) {
  const maskedPayload = packet[1];

  if (
    maskedPayload &&
    typeof maskedPayload === 'object' &&
    MASK_SOCKET_ARGS_KEY in maskedPayload &&
    MASK_SOCKET_VERSION_KEY in maskedPayload &&
    (maskedPayload as Record<string, unknown>)[MASK_SOCKET_VERSION_KEY] === MASK_VERSION
  ) {
    const payload = (maskedPayload as Record<string, unknown>)[MASK_SOCKET_ARGS_KEY];

    if (typeof payload !== 'string') {
      throw new Error('Invalid masked socket payload');
    }

    const args = unmaskPayload<unknown[]>(payload);

    packet.splice(1, 1, ...args);
  }
}

async function emitUserPresence(io: SocketServer, userId: string, isOnline: boolean, showLastSeen: boolean, lastSeenAt: Date | null) {
  const rooms = await getPresenceRecipientRooms(userId);

  if (rooms.length === 0) {
    return;
  }

  io.to(rooms).emit('presence:update', {
    isOnline: showLastSeen ? isOnline : false,
    lastSeenAt: showLastSeen ? lastSeenAt?.toISOString() ?? null : null,
    showLastSeen,
    userId,
  });
}

async function getPresenceRecipientRooms(userId: string) {
  const cached = presenceRecipientRoomsByUser.get(userId);

  if (cached && Date.now() - cached.checkedAt < PRESENCE_RECIPIENT_CACHE_TTL_MS) {
    return cached.rooms;
  }

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
    where: { userId },
  });
  const rooms = new Set<string>();

  memberships.forEach((membership) => {
    membership.conversation.members.forEach((member) => {
      if (member.userId !== userId) {
        rooms.add(`user:${member.userId}`);
      }
    });
  });

  const roomList = [...rooms];

  presenceRecipientRoomsByUser.set(userId, {
    checkedAt: Date.now(),
    rooms: roomList,
  });

  return roomList;
}
