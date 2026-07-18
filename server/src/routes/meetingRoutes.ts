import crypto from 'crypto';
import { Request, Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';

import { getAuthedUser, requireAuth } from '../auth';
import { HttpError } from '../httpError';
import { selectLiveKitServer } from '../livekitPool';
import { prisma } from '../prisma';

export const meetingRoutes = Router();

const DEFAULT_MEETING_SECONDS = 60 * 60;
const MEETING_RESET_SECONDS = 15 * 60;
const MEETING_CLEANUP_THROTTLE_MS = 10_000;
let lastMeetingCleanupAt = 0;
let activeMeetingCleanup: Promise<void> | null = null;

type MeetingRow = {
  code: string;
  creatorDisplayName: string;
  creatorId: string;
  creatorUsername: string;
  durationLimitSeconds: number;
  endedAt: Date | null;
  id: string;
  livekitRoom: string | null;
  livekitServerId: string | null;
  maxEndsAt: Date;
  mode: 'VOICE' | 'VIDEO';
  startedAt: Date;
  status: 'ACTIVE' | 'ENDED';
};

type MeetingParticipantRow = {
  displayName: string;
  guestId: string | null;
  id: string;
  joinedAt: Date;
  leftAt: Date | null;
  role: 'HOST' | 'GUEST';
  userId: string | null;
};

type MeetingUsageSummary = {
  availableSeconds: number;
  resetAt: string;
  spentSeconds: number;
};

const createMeetingSchema = z.object({
  mode: z.enum(['VOICE', 'VIDEO']),
});

const joinMeetingSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  guestId: z.string().trim().min(8).max(120).optional(),
});

const leaveMeetingSchema = z.object({
  guestId: z.string().trim().min(8).max(120).optional(),
  participantId: z.string().trim().min(1).max(160).optional(),
});

meetingRoutes.post('/', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = createMeetingSchema.parse(req.body);

    await cleanupExpiredMeetings(req);

    const activeMeeting = await findActiveMeetingByCreator(currentUser.id);

    if (activeMeeting) {
      res.status(200).json({ meeting: serializeMeeting(activeMeeting), remainingSeconds: getMeetingRemainingSeconds(activeMeeting) });
      return;
    }

    const remainingSeconds = await getCreatorRemainingMeetingSeconds(currentUser.id);

    if (remainingSeconds <= 0) {
      throw new HttpError(429, 'Meeting limit reached. Try again after 15 minutes.', {
        retryAfterSeconds: MEETING_RESET_SECONDS,
      });
    }

    const id = crypto.randomUUID();
    const code = await createUniqueMeetingCode();
    const livekitRoom = `meet-${id}`;
    const now = new Date();
    const maxEndsAt = new Date(now.getTime() + remainingSeconds * 1000);
    const [meeting] = await prisma.$queryRaw<MeetingRow[]>`
      insert into "Meeting" (
        "id", "code", "creatorId", "mode", "status", "livekitRoom",
        "startedAt", "maxEndsAt", "durationLimitSeconds", "createdAt", "updatedAt"
      )
      values (
        ${id}, ${code}, ${currentUser.id}, ${input.mode}::"CallMode", 'ACTIVE'::"MeetingStatus", ${livekitRoom},
        ${now}, ${maxEndsAt}, ${remainingSeconds}, ${now}, ${now}
      )
      returning
        "Meeting".*,
        ${currentUser.displayName}::text as "creatorDisplayName",
        ${currentUser.username}::text as "creatorUsername"
    `;

    await prisma.$executeRaw`
      insert into "MeetingUsageWindow" ("id", "creatorId", "windowStartedAt", "consumedSeconds", "createdAt", "updatedAt")
      values (${crypto.randomUUID()}, ${currentUser.id}, ${now}, 0, ${now}, ${now})
      on conflict ("creatorId") do update
        set "windowStartedAt" = case
              when "MeetingUsageWindow"."lastEndedAt" is null
                or "MeetingUsageWindow"."lastEndedAt" <= ${new Date(now.getTime() - MEETING_RESET_SECONDS * 1000)}
              then ${now}
              else "MeetingUsageWindow"."windowStartedAt"
            end,
            "consumedSeconds" = case
              when "MeetingUsageWindow"."lastEndedAt" is null
                or "MeetingUsageWindow"."lastEndedAt" <= ${new Date(now.getTime() - MEETING_RESET_SECONDS * 1000)}
              then 0
              else "MeetingUsageWindow"."consumedSeconds"
            end,
            "updatedAt" = ${now}
    `;

    res.status(201).json({ meeting: serializeMeeting(meeting), remainingSeconds });
  } catch (error) {
    next(error);
  }
});

meetingRoutes.get('/:code', async (req, res, next) => {
  try {
    await cleanupExpiredMeetings(req);
    const meeting = await findMeetingByCode(getRouteCode(req));

    if (!meeting) {
      throw new HttpError(404, 'Meeting not found');
    }

    res.json({
      meeting: serializeMeeting(meeting),
      participants: await listMeetingParticipants(meeting.id),
      remainingSeconds: getMeetingRemainingSeconds(meeting),
    });
  } catch (error) {
    next(error);
  }
});

meetingRoutes.post('/:code/join', async (req, res, next) => {
  try {
    await cleanupExpiredMeetings(req);
    const input = joinMeetingSchema.parse(req.body);
    const authedUser = await getOptionalAuthedUser(req).catch(() => null);
    const meeting = await findMeetingByCode(getRouteCode(req));

    if (!meeting || meeting.status !== 'ACTIVE' || meeting.endedAt) {
      throw new HttpError(404, 'Meeting not found');
    }

    const remainingSeconds = getMeetingRemainingSeconds(meeting);

    if (remainingSeconds <= 0) {
      await endMeeting(req, meeting, 'expired');
      throw new HttpError(410, 'Meeting ended');
    }

    const guestId = authedUser ? null : input.guestId ?? `guest-${crypto.randomUUID()}`;
    const displayName = authedUser?.displayName || input.displayName || 'Guest';
    const role = authedUser?.id === meeting.creatorId ? 'HOST' : 'GUEST';
    const participantIdentity = authedUser?.id ?? `guest:${guestId}`;
    const now = new Date();

    if (authedUser) {
      await prisma.$executeRaw`
        update "MeetingParticipant"
        set "leftAt" = ${now}, "updatedAt" = ${now}
        where "meetingId" = ${meeting.id}
          and "userId" = ${authedUser.id}
          and "leftAt" is null
      `;
    } else {
      await prisma.$executeRaw`
        update "MeetingParticipant"
        set "leftAt" = ${now}, "updatedAt" = ${now}
        where "meetingId" = ${meeting.id}
          and "guestId" = ${guestId}
          and "leftAt" is null
      `;
    }

    const [participant] = await prisma.$queryRaw<MeetingParticipantRow[]>`
      insert into "MeetingParticipant" (
        "id", "meetingId", "userId", "guestId", "displayName", "role", "joinedAt", "updatedAt"
      )
      values (
        ${crypto.randomUUID()}, ${meeting.id}, ${authedUser?.id ?? null}, ${guestId}, ${displayName},
        ${role}::"MeetingParticipantRole", ${now}, ${now}
      )
      returning *
    `;
    const livekit = await issueMeetingJoinCredentials(meeting, participantIdentity, displayName, remainingSeconds);

    emitMeetingParticipantsChanged(req, meeting.id);
    res.json({
      guestId,
      livekit,
      meeting: serializeMeeting(meeting),
      participant,
      remainingSeconds,
    });
  } catch (error) {
    next(error);
  }
});

meetingRoutes.post('/:code/leave', async (req, res, next) => {
  try {
    const input = leaveMeetingSchema.parse(req.body);
    const authedUser = await getOptionalAuthedUser(req).catch(() => null);
    const meeting = await findMeetingByCode(getRouteCode(req));

    if (!meeting) {
      throw new HttpError(404, 'Meeting not found');
    }

    const now = new Date();

    if (input.participantId) {
      await prisma.$executeRaw`
        update "MeetingParticipant"
        set "leftAt" = ${now}, "updatedAt" = ${now}
        where "id" = ${input.participantId}
          and "meetingId" = ${meeting.id}
      `;
    } else if (authedUser) {
      await prisma.$executeRaw`
        update "MeetingParticipant"
        set "leftAt" = ${now}, "updatedAt" = ${now}
        where "meetingId" = ${meeting.id}
          and "userId" = ${authedUser.id}
          and "leftAt" is null
      `;
    } else if (input.guestId) {
      await prisma.$executeRaw`
        update "MeetingParticipant"
        set "leftAt" = ${now}, "updatedAt" = ${now}
        where "meetingId" = ${meeting.id}
          and "guestId" = ${input.guestId}
          and "leftAt" is null
      `;
    }

    emitMeetingParticipantsChanged(req, meeting.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

meetingRoutes.post('/:code/end', requireAuth, async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const meeting = await findMeetingByCode(getRouteCode(req));

    if (!meeting) {
      throw new HttpError(404, 'Meeting not found');
    }

    if (meeting.creatorId !== currentUser.id) {
      throw new HttpError(403, 'Only the meeting host can end this meeting');
    }

    const usage = await endMeeting(req, meeting, 'host');
    res.json({
      meeting: serializeMeeting({ ...meeting, endedAt: new Date(), status: 'ENDED' }),
      usage,
    });
  } catch (error) {
    next(error);
  }
});

meetingRoutes.get('/:code/participants', async (req, res, next) => {
  try {
    const meeting = await findMeetingByCode(getRouteCode(req));

    if (!meeting) {
      throw new HttpError(404, 'Meeting not found');
    }

    res.json({ participants: await listMeetingParticipants(meeting.id) });
  } catch (error) {
    next(error);
  }
});

async function issueMeetingJoinCredentials(
  meeting: MeetingRow,
  identity: string,
  displayName: string,
  remainingSeconds: number,
) {
  const liveKitServer = await selectLiveKitServer({
    assignedServerId: meeting.livekitServerId,
  });

  if (!liveKitServer) {
    throw new HttpError(500, 'LiveKit is not configured');
  }

  const roomName = meeting.livekitRoom || `meet-${meeting.id}`;

  if (!meeting.livekitRoom && meeting.livekitServerId !== liveKitServer.id) {
    await prisma.$executeRaw`
      update "Meeting"
      set "livekitRoom" = ${roomName},
          "livekitServerId" = ${liveKitServer.id},
          "updatedAt" = ${new Date()}
      where "id" = ${meeting.id}
    `;
  } else if (!meeting.livekitRoom) {
    await prisma.$executeRaw`
      update "Meeting"
      set "livekitRoom" = ${roomName},
          "updatedAt" = ${new Date()}
      where "id" = ${meeting.id}
    `;
  } else if (meeting.livekitServerId !== liveKitServer.id) {
    await prisma.$executeRaw`
      update "Meeting"
      set "livekitServerId" = ${liveKitServer.id},
          "updatedAt" = ${new Date()}
      where "id" = ${meeting.id}
    `;
  }

  const token = new AccessToken(liveKitServer.apiKey, liveKitServer.apiSecret, {
    identity,
    name: displayName,
    ttl: `${Math.max(300, remainingSeconds + 300)}s`,
  });

  token.addGrant({
    canPublish: true,
    canSubscribe: true,
    room: roomName,
    roomJoin: true,
  });

  return {
    roomName,
    token: await token.toJwt(),
    url: liveKitServer.url,
  };
}

async function getCreatorRemainingMeetingSeconds(creatorId: string) {
  const now = new Date();
  const resetBoundary = new Date(now.getTime() - MEETING_RESET_SECONDS * 1000);
  const [window] = await prisma.$queryRaw<Array<{ consumedSeconds: number; lastEndedAt: Date | null }>>`
    select "consumedSeconds", "lastEndedAt"
    from "MeetingUsageWindow"
    where "creatorId" = ${creatorId}
    limit 1
  `;

  if (!window || !window.lastEndedAt || window.lastEndedAt <= resetBoundary) {
    return DEFAULT_MEETING_SECONDS;
  }

  return Math.max(0, DEFAULT_MEETING_SECONDS - window.consumedSeconds);
}

async function findActiveMeetingByCreator(creatorId: string) {
  const [meeting] = await prisma.$queryRaw<MeetingRow[]>`
    select m.*, u."displayName" as "creatorDisplayName", u."username" as "creatorUsername"
    from "Meeting" m
    join "User" u on u.id = m."creatorId"
    where m."creatorId" = ${creatorId}
      and m."status" = 'ACTIVE'::"MeetingStatus"
      and m."endedAt" is null
      and m."maxEndsAt" > now()
    order by m."startedAt" desc
    limit 1
  `;

  return meeting ?? null;
}

async function findMeetingByCode(code: string) {
  const [meeting] = await prisma.$queryRaw<MeetingRow[]>`
    select m.*, u."displayName" as "creatorDisplayName", u."username" as "creatorUsername"
    from "Meeting" m
    join "User" u on u.id = m."creatorId"
    where lower(m."code") = lower(${code})
    limit 1
  `;

  return meeting ?? null;
}

async function listMeetingParticipants(meetingId: string) {
  return prisma.$queryRaw<MeetingParticipantRow[]>`
    select *
    from "MeetingParticipant"
    where "meetingId" = ${meetingId}
      and "leftAt" is null
    order by lower("displayName") asc, "joinedAt" asc
  `;
}

async function createUniqueMeetingCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      select "id" from "Meeting" where lower("code") = lower(${code}) limit 1
    `;

    if (rows.length === 0) {
      return code;
    }
  }

  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function getMeetingRemainingSeconds(meeting: MeetingRow) {
  if (meeting.status !== 'ACTIVE' || meeting.endedAt) {
    return 0;
  }

  return Math.max(0, Math.ceil((meeting.maxEndsAt.getTime() - Date.now()) / 1000));
}

function serializeMeeting(meeting: MeetingRow) {
  return {
    code: meeting.code,
    creator: {
      displayName: meeting.creatorDisplayName,
      id: meeting.creatorId,
      username: meeting.creatorUsername,
    },
    durationLimitSeconds: meeting.durationLimitSeconds,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    id: meeting.id,
    link: `https://meet.meetvap.com/${encodeURIComponent(meeting.code)}`,
    maxEndsAt: meeting.maxEndsAt.toISOString(),
    mode: meeting.mode === 'VIDEO' ? 'video' : 'voice',
    startedAt: meeting.startedAt.toISOString(),
    status: meeting.status.toLowerCase(),
  };
}

async function endMeeting(req: Request, meeting: MeetingRow, reason: 'expired' | 'host'): Promise<MeetingUsageSummary> {
  const fallbackSpentSeconds = Math.max(1, Math.min(
    meeting.durationLimitSeconds,
    Math.ceil(((meeting.endedAt ?? new Date()).getTime() - meeting.startedAt.getTime()) / 1000),
  ));

  if (meeting.endedAt || meeting.status !== 'ACTIVE') {
    return {
      availableSeconds: await getCreatorRemainingMeetingSeconds(meeting.creatorId),
      resetAt: new Date((meeting.endedAt ?? new Date()).getTime() + MEETING_RESET_SECONDS * 1000).toISOString(),
      spentSeconds: fallbackSpentSeconds,
    };
  }

  const now = new Date();
  const consumedSeconds = Math.max(1, Math.min(
    meeting.durationLimitSeconds,
    Math.ceil((now.getTime() - meeting.startedAt.getTime()) / 1000),
  ));

  await prisma.$executeRaw`
    update "Meeting"
    set "status" = 'ENDED'::"MeetingStatus",
        "endedAt" = ${now},
        "updatedAt" = ${now}
    where "id" = ${meeting.id}
      and "endedAt" is null
  `;
  await prisma.$executeRaw`
    update "MeetingParticipant"
    set "leftAt" = coalesce("leftAt", ${now}),
        "updatedAt" = ${now}
    where "meetingId" = ${meeting.id}
  `;
  await prisma.$executeRaw`
    insert into "MeetingUsageWindow" ("id", "creatorId", "windowStartedAt", "lastEndedAt", "consumedSeconds", "createdAt", "updatedAt")
    values (${crypto.randomUUID()}, ${meeting.creatorId}, ${meeting.startedAt}, ${now}, ${consumedSeconds}, ${now}, ${now})
    on conflict ("creatorId") do update
      set "lastEndedAt" = ${now},
          "consumedSeconds" = "MeetingUsageWindow"."consumedSeconds" + ${consumedSeconds},
          "updatedAt" = ${now}
  `;
  req.app.get('io')?.to(`meeting:${meeting.id}`).emit('meeting:ended', {
    code: meeting.code,
    meetingId: meeting.id,
    reason,
  });

  return {
    availableSeconds: await getCreatorRemainingMeetingSeconds(meeting.creatorId),
    resetAt: new Date(now.getTime() + MEETING_RESET_SECONDS * 1000).toISOString(),
    spentSeconds: consumedSeconds,
  };
}

function emitMeetingParticipantsChanged(req: Request, meetingId: string) {
  req.app.get('io')?.to(`meeting:${meetingId}`).emit('meeting:participants', { meetingId });
}

export async function cleanupExpiredMeetings(req?: Request) {
  const nowMs = Date.now();

  if (activeMeetingCleanup) {
    return activeMeetingCleanup;
  }

  if (nowMs - lastMeetingCleanupAt < MEETING_CLEANUP_THROTTLE_MS) {
    return;
  }

  activeMeetingCleanup = cleanupExpiredMeetingsNow(req).finally(() => {
    lastMeetingCleanupAt = Date.now();
    activeMeetingCleanup = null;
  });

  return activeMeetingCleanup;
}

async function cleanupExpiredMeetingsNow(req?: Request) {
  const meetings = await prisma.$queryRaw<MeetingRow[]>`
    select m.*, u."displayName" as "creatorDisplayName", u."username" as "creatorUsername"
    from "Meeting" m
    join "User" u on u.id = m."creatorId"
    where m."status" = 'ACTIVE'::"MeetingStatus"
      and m."endedAt" is null
      and m."maxEndsAt" <= now()
    limit 50
  `;

  for (const meeting of meetings) {
    await endMeeting(req ?? createNoopRequest(), meeting, 'expired');
  }
}

function createNoopRequest() {
  return {
    app: {
      get: () => undefined,
    },
  } as unknown as Request;
}

function getRouteCode(req: Request) {
  const value = req.params.code;
  return Array.isArray(value) ? value[0] : value;
}

async function getOptionalAuthedUser(req: Request) {
  const authorization = req.header('Authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  await new Promise<void>((resolve, reject) => {
    requireAuth(req, {} as never, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return req.user ?? null;
}
