import { Request, Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import { getAuthedUser, requireAuth } from '../auth';
import { config } from '../config';
import { isConversationMembershipMuted } from '../conversationMute';
import { HttpError } from '../httpError';
import { selectLiveKitServer } from '../livekitPool';
import { prisma } from '../prisma';
import { getCachedPushTokensForUsers } from '../pushTokenCache';
import { sendCallEndedPush, sendIncomingCallPush } from '../pushNotifications';
import { serializeMessage } from '../serializers';
import { recordMessageStats } from '../stats';
import { hasPremiumFeatureAccess } from '../subscriptions';
import { createCallSchema, inviteCallParticipantSchema } from '../validators';
import { assertNotBlockedBetween } from './userRoutes';

export const callRoutes = Router();
export const publicCallRoutes = Router();

callRoutes.use(requireAuth);

const MAX_VOICE_PARTICIPANTS = 8;
const MAX_VIDEO_PARTICIPANTS = 6;
const CALL_RINGING_RECEIPT_TTL_MS = 5 * 60 * 1000;

type CallPushToken = {
  locale: string | null;
  platform: string | null;
  provider: string;
  token: string;
  userId?: string;
};

function logCallDebug(event: string, details?: Record<string, unknown>) {
  console.info('call-debug', {
    event,
    ...details,
  });
}

publicCallRoutes.post('/:callId/ringing', async (req, res, next) => {
  try {
    const expiresAt = getSingleQueryValue(req.query.expiresAt);
    const signature = getSingleQueryValue(req.query.signature);

    if (!isValidCallRingingReceipt(req.params.callId, expiresAt, signature)) {
      throw new HttpError(401, 'Invalid ringing receipt');
    }

    const call = await prisma.call.findFirst({
      include: {
        conversation: {
          include: {
            members: {
              select: { userId: true },
            },
          },
        },
        participants: {
          select: { userId: true },
        },
      },
      where: {
        endedAt: null,
        id: req.params.callId,
      },
    });

    if (!call) {
      res.json({ ok: true });
      return;
    }

    emitCallRinging(req, call, 'push-receipt');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function issueCallJoinCredentials(req: Request, call: { id: string; livekitRoom: string | null; livekitServerId?: string | null }, currentUser: { displayName: string; id: string }) {
  const startedAt = Date.now();

  const liveKitServer = await selectLiveKitServer({
    assignedServerId: call.livekitServerId,
  });

  if (!liveKitServer) {
    logCallDebug('issue-token-not-configured', {
      callId: call.id,
      userId: currentUser.id,
    });
    return null;
  }

  const roomName = call.livekitRoom || `call-${call.id}`;
  const updateData: { livekitRoom?: string; livekitServerId?: string } = {};

  if (!call.livekitRoom) {
    updateData.livekitRoom = roomName;
  }

  if (call.livekitServerId !== liveKitServer.id) {
    updateData.livekitServerId = liveKitServer.id;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.call.update({
      data: updateData,
      where: { id: call.id },
    });
  }

  const token = new AccessToken(liveKitServer.apiKey, liveKitServer.apiSecret, {
    identity: currentUser.id,
    name: currentUser.displayName,
    ttl: '2h',
  });

  token.addGrant({
    canPublish: true,
    canSubscribe: true,
    room: roomName,
    roomJoin: true,
  });

  const credentials = {
    roomName,
    token: await token.toJwt(),
    url: liveKitServer.url,
  };

  logCallDebug('issue-token-ready', {
    callId: call.id,
    elapsedMs: Date.now() - startedAt,
    roomName,
    serverId: liveKitServer.id,
    userId: currentUser.id,
  });

  return credentials;
}

callRoutes.post('/:callId/feedback', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const stars = Number(req.body?.stars);

    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new HttpError(400, 'Rating must be between 1 and 5');
    }

    const call = await prisma.call.findFirst({
      include: {
        participants: {
          select: { userId: true },
        },
        conversation: {
          select: {
            members: {
              select: { userId: true },
            },
          },
        },
      },
      where: {
        id: req.params.callId,
        participants: { some: { userId: currentUser.id } },
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    const participantUserIds = Array.from(new Set(call.participants.map((participant) => participant.userId)));

    const feedbackId = crypto.randomUUID();
    const participantUserIdsJson = JSON.stringify(participantUserIds);

    await prisma.$executeRaw`
      insert into "CallFeedback" ("id", "callId", "ratedById", "stars", "participantUserIds", "participantCount")
      values (${feedbackId}, ${call.id}, ${currentUser.id}, ${stars}, ${participantUserIdsJson}::jsonb, ${participantUserIds.length})
      on conflict ("callId", "ratedById")
      do update set
        "stars" = excluded."stars",
        "participantUserIds" = excluded."participantUserIds",
        "participantCount" = excluded."participantCount"
    `;

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

callRoutes.get('/:callId/status', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const call = await prisma.call.findFirst({
      select: {
        conversationId: true,
        endedAt: true,
        id: true,
        participants: {
          select: {
            direction: true,
            joinedAt: true,
            leftAt: true,
            userId: true,
          },
        },
      },
      where: {
        id: req.params.callId,
        OR: [
          {
            conversation: {
              members: {
                some: { userId: currentUser.id },
              },
            },
          },
          {
            participants: {
              some: { userId: currentUser.id },
            },
          },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    res.json({
      call: {
        callStatus: getCallStatus({
          endedAt: call.endedAt,
          endedById: undefined,
          participants: call.participants,
        }),
        conversationId: call.conversationId,
        endedAt: call.endedAt,
        id: call.id,
      },
    });
  } catch (error) {
    next(error);
  }
});

callRoutes.get('/:callId/screenshot-privacy', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const call = await prisma.call.findFirst({
      include: {
        conversation: {
          select: {
            members: {
              select: { userId: true },
            },
            type: true,
          },
        },
        participants: {
          select: { userId: true },
        },
      },
      where: {
        id: req.params.callId,
        OR: [
          { participants: { some: { userId: currentUser.id } } },
          { conversation: { members: { some: { userId: currentUser.id } } } },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    if (call.conversation.type !== 'DIRECT') {
      const groupPrivacyRows = await prisma.$queryRaw<Array<{ ownerId: string | null; preventScreenshots: boolean }>>`
        select "ownerId", "preventScreenshots" from "Conversation" where "id" = ${call.conversationId} limit 1
      `;
      const groupPrivacy = groupPrivacyRows[0];
      const ownerHasPremiumAccess = groupPrivacy?.ownerId ? await hasPremiumFeatureAccess(groupPrivacy.ownerId) : false;

      res.json({ preventPeerScreenshots: groupPrivacy?.preventScreenshots === true && ownerHasPremiumAccess });
      return;
    }

    const participantIds = Array.from(new Set([
      ...call.conversation.members.map((member) => member.userId),
      ...call.participants.map((participant) => participant.userId),
    ]
      .filter((userId) => userId !== currentUser.id)));

    if (participantIds.length === 0) {
      res.json({ preventPeerScreenshots: false });
      return;
    }

    const rows = await prisma.$queryRaw<Array<{ id: string; preventPeerScreenshots: boolean }>>`
      select "id", "preventPeerScreenshots" from "User"
      where "id" in (${Prisma.join(participantIds)})
    `;
    const premiumAccessByUserId = new Map(await Promise.all(
      rows.map(async (row) => [row.id, await hasPremiumFeatureAccess(row.id)] as const),
    ));

    res.json({ preventPeerScreenshots: rows.some((row) => row.preventPeerScreenshots !== false && premiumAccessByUserId.get(row.id) === true) });
  } catch (error) {
    next(error);
  }
});

callRoutes.get('/:callId/token', async (req, res, next) => {
  const requestStartedAt = Date.now();

  try {
    const currentUser = getAuthedUser(req);
    logCallDebug('token-start', {
      callId: req.params.callId,
      userId: currentUser.id,
    });
    const call = await prisma.call.findFirst({
      where: {
        id: req.params.callId,
        OR: [
          {
            conversation: {
              members: {
                some: { userId: currentUser.id },
              },
            },
          },
          {
            participants: {
              some: { userId: currentUser.id },
            },
          },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    const joinCredentials = await issueCallJoinCredentials(req, call, currentUser);

    if (!joinCredentials) {
      throw new HttpError(500, 'LiveKit is not configured');
    }

    logCallDebug('token-response', {
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      userId: currentUser.id,
    });

    res.json(joinCredentials);
  } catch (error) {
    next(error);
  }
});

callRoutes.post('/:callId/invite', async (req, res, next) => {
  const requestStartedAt = Date.now();

  try {
    const currentUser = getAuthedUser(req);
    const input = inviteCallParticipantSchema.parse(req.body);

    if (input.userId === currentUser.id) {
      throw new HttpError(400, 'Cannot invite yourself to a call');
    }

    const call = await prisma.call.findFirst({
      include: {
        conversation: {
          include: {
            members: {
              select: {
                mutedAt: true,
                mutedUntil: true,
                userId: true,
                user: {
                  select: {
                    displayName: true,
                    username: true,
                  },
                },
              },
            },
          },
        },
        participants: {
          select: {
            joinedAt: true,
            leftAt: true,
            userId: true,
            user: {
              select: {
                displayName: true,
                username: true,
              },
            },
          },
        },
      },
      where: {
        endedAt: null,
        id: req.params.callId,
        OR: [
          {
            conversation: {
              members: {
                some: { userId: currentUser.id },
              },
            },
          },
          {
            participants: {
              some: { userId: currentUser.id },
            },
          },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    const invitedUser = await prisma.user.findUnique({
      select: {
        displayName: true,
        hideFromSearch: true,
        hideNickname: true,
        id: true,
        username: true,
      },
      where: { id: input.userId },
    });

    if (!invitedUser) {
      throw new HttpError(404, 'User not found');
    }

    await assertNotBlockedBetween(currentUser.id, input.userId);
    const existingInvitedParticipant = call.participants.find((participant) => participant.userId === input.userId);

    const participantCount = new Set([
      ...call.conversation.members.map((member) => member.userId),
      ...call.participants.map((participant) => participant.userId),
      input.userId,
    ]).size;
    const maxParticipants = call.mode === 'VIDEO' ? MAX_VIDEO_PARTICIPANTS : MAX_VOICE_PARTICIPANTS;

    if (participantCount > maxParticipants) {
      throw new HttpError(409, call.mode === 'VIDEO'
        ? 'Video calls can include up to 6 people'
        : 'Voice calls can include up to 8 people');
    }

    await prisma.callParticipant.upsert({
      create: {
        callId: call.id,
        direction: 'INCOMING',
        userId: input.userId,
      },
      update: existingInvitedParticipant?.leftAt ? { joinedAt: null, leftAt: null } : {},
      where: {
        callId_userId: {
          callId: call.id,
          userId: input.userId,
        },
      },
    });

    const invitedMembership = call.conversation.members.find((member) => member.userId === input.userId);
    const canNotifyInvitedUser = !isConversationMembershipMuted(invitedMembership);

    if (canNotifyInvitedUser) {
      emitIncomingCallInvite(req, [`user:${input.userId}`], {
        callId: call.id,
        conversationId: call.conversationId,
        fromDisplayName: currentUser.displayName,
        fromUserId: currentUser.id,
        isGroupCall: true,
        mode: call.mode,
        participantNames: getCallParticipantNames([
          ...call.participants,
          { user: invitedUser },
        ]),
      });
    }

    if (!invitedMembership) {
      const directConversation = await findExistingDirectConversation(currentUser.id, input.userId);

      if (directConversation) {
        const directCallMessage = await createOrUpdateCallMessage({
          callId: call.id,
          conversationId: directConversation.id,
          mode: call.mode,
          senderId: currentUser.id,
          startedAt: call.startedAt,
        });

        await updateConversationPreviewFromMessage(directConversation.id, directCallMessage);
        req.app.get('io')?.to(directConversation.id).to(getUniqueUserRooms([{ userId: currentUser.id }, { userId: input.userId }])).emit('message:new', serializeMessage(directCallMessage));
        req.app.get('io')?.to(getUniqueUserRooms([{ userId: currentUser.id }, { userId: input.userId }])).emit('conversation:updated', { conversationId: directConversation.id });
      }
    }

    if (canNotifyInvitedUser) {
      void (async () => {
        if (!(await isCallStillActive(call.id))) {
          return;
        }

        const pendingInviteeIds = await getPendingCallInviteeUserIds(call.id, [input.userId]);

        if (pendingInviteeIds.length === 0) {
          return;
        }

        await sendIncomingCallPushToUsers({
          avatarUrl: call.conversation.avatarUrl ?? null,
          body: call.mode === 'VOICE' ? 'Incoming group voice call' : 'Incoming group video call',
          callId: call.id,
          conversationId: call.conversationId,
          elapsedMs: Date.now() - requestStartedAt,
          isGroupCall: true,
          mode: call.mode,
          participantNames: getCallParticipantNames([
            ...call.participants,
            { user: invitedUser },
          ]),
          ringingReceiptUrl: createCallRingingReceiptUrl(req, call.id),
          title: currentUser.displayName || currentUser.username,
          userIds: pendingInviteeIds,
        });
      })().catch((error) => {
        logCallDebug('invite-push-failed', {
          callId: call.id,
          elapsedMs: Date.now() - requestStartedAt,
          message: error instanceof Error ? error.message : 'unknown',
        });
      });
    }

    res.json({ user: invitedUser });
  } catch (error) {
    next(error);
  }
});

callRoutes.post('/', async (req, res, next) => {
  const requestStartedAt = Date.now();

  try {
    const currentUser = getAuthedUser(req);
    const input = createCallSchema.parse(req.body);
    logCallDebug('create-start', {
      conversationId: input.conversationId,
      inviteeUserIds: input.inviteeUserIds,
      mode: input.mode,
      userId: currentUser.id,
    });
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: input.conversationId,
          userId: currentUser.id,
        },
      },
    });

    if (!member) {
      throw new HttpError(404, 'Conversation not found');
    }

    const conversation = await prisma.conversation.findUnique({
      include: {
        members: {
          select: {
            mutedAt: true,
            mutedUntil: true,
            userId: true,
            user: {
              select: {
                displayName: true,
                username: true,
              },
            },
          },
        },
      },
      where: { id: input.conversationId },
    });
    const existingActiveDirectCall = conversation?.type === 'DIRECT'
      ? await prisma.call.findFirst({
          include: {
            conversation: {
              include: {
                members: {
                  select: {
                    userId: true,
                  },
                },
              },
            },
            participants: {
              select: {
                joinedAt: true,
                userId: true,
              },
            },
          },
          orderBy: { startedAt: 'desc' },
          where: {
            conversationId: input.conversationId,
            endedAt: null,
            mode: input.mode,
          },
        })
      : null;

    const canAutoJoinExistingDirectCall = !!existingActiveDirectCall &&
      existingActiveDirectCall.participants.some((participant) => (
        participant.userId === currentUser.id &&
        participant.joinedAt === null
      )) &&
      existingActiveDirectCall.participants.some((participant) => (
        participant.userId !== currentUser.id &&
        participant.joinedAt !== null
      ));

    if (canAutoJoinExistingDirectCall && existingActiveDirectCall) {
      await prisma.callParticipant.upsert({
        create: {
          callId: existingActiveDirectCall.id,
          direction: 'INCOMING',
          joinedAt: new Date(),
          userId: currentUser.id,
        },
        update: { joinedAt: new Date(), leftAt: null },
        where: {
          callId_userId: {
            callId: existingActiveDirectCall.id,
            userId: currentUser.id,
          },
        },
      });

      const updatedExistingCall = await prisma.call.findUnique({
        include: {
          conversation: {
            include: {
              members: {
                select: { userId: true },
              },
            },
          },
          participants: {
            select: {
              joinedAt: true,
              userId: true,
            },
          },
        },
        where: { id: existingActiveDirectCall.id },
      });
      const callForJoin = updatedExistingCall ?? existingActiveDirectCall;
      const memberRooms = getCallUserRooms(callForJoin);
      req.app.get('io')?.to(memberRooms).emit('call:answered', {
        callId: existingActiveDirectCall.id,
        conversationId: existingActiveDirectCall.conversationId,
        userId: currentUser.id,
      });
      await markCallMessageReadByUser(req, existingActiveDirectCall.id, existingActiveDirectCall.conversationId, currentUser.id);

      const livekit = await issueCallJoinCredentials(req, callForJoin, currentUser);

      res.status(201).json({ call: callForJoin, livekit });
      return;
    }

    const requestedInviteeIds = input.inviteeUserIds?.length
      ? new Set(input.inviteeUserIds)
      : null;
    const calleeMembers = conversation?.members
      .filter((item) => (
        item.userId !== currentUser.id &&
        (!requestedInviteeIds || requestedInviteeIds.has(item.userId))
      )) ?? [];
    const notifiableMembers = calleeMembers
      .filter((item) => !isConversationMembershipMuted(item));
    const memberRooms = notifiableMembers
      .map((item) => `user:${item.userId}`) ?? [];
    const calleeIds = calleeMembers
      .map((item) => item.userId) ?? [];
    const notifiableCalleeIds = notifiableMembers
      .map((item) => item.userId) ?? [];
    const initialParticipantCount = calleeIds.length + 1;
    const isGroupCall = conversation?.type === 'GROUP' || initialParticipantCount > 2;
    const maxParticipants = input.mode === 'VIDEO' ? MAX_VIDEO_PARTICIPANTS : MAX_VOICE_PARTICIPANTS;

    if (calleeIds.length === 0) {
      logCallDebug('create-no-callees', {
        conversationId: input.conversationId,
        requestedInviteeIds: input.inviteeUserIds,
        userId: currentUser.id,
      });
      throw new HttpError(409, 'No call recipients are available');
    }

    if (initialParticipantCount > maxParticipants) {
      throw new HttpError(409, input.mode === 'VIDEO'
        ? 'Video calls can include up to 6 people'
        : 'Voice calls can include up to 8 people');
    }

    await Promise.all(calleeIds.map((calleeId) => assertNotBlockedBetween(currentUser.id, calleeId)));

    if (!isGroupCall) {
      await assertContactsOnlyCallAllowed(currentUser.id, calleeIds);
    }

    const call = await prisma.call.create({
      data: {
        conversationId: input.conversationId,
        livekitRoom: input.livekitRoom ?? `call-${crypto.randomUUID()}`,
        mode: input.mode,
        participants: {
          create: [
            {
              direction: 'OUTGOING',
              joinedAt: new Date(),
              userId: currentUser.id,
            },
            ...calleeIds.map((calleeId) => ({
              direction: 'INCOMING' as const,
              userId: calleeId,
            })),
          ],
        },
      },
      include: {
        participants: true,
      },
    });
    logCallDebug('create-db-call-ready', {
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      livekitRoom: call.livekitRoom,
      mode: call.mode,
      participantCount: call.participants.length,
    });
    const callMessage = await createOrUpdateCallMessage({
      callId: call.id,
      conversationId: input.conversationId,
      messageKey: input.messageKey,
      mode: input.mode,
      senderId: currentUser.id,
      startedAt: call.startedAt,
    });
    await prisma.conversation.update({
      data: {
        lastMessageAt: callMessage.createdAt,
        lastMessageBody: callMessage.body,
        lastMessageKind: callMessage.kind,
        lastMessageSenderId: callMessage.senderId,
        lastMessageStatus: callMessage.status,
        updatedAt: new Date(),
      },
      where: { id: input.conversationId },
    });
    req.app.get('io')?.to(input.conversationId).to(getUniqueUserRooms([{ userId: currentUser.id }, ...calleeIds.map((userId) => ({ userId }))])).emit('message:new', serializeMessage(callMessage));

    emitIncomingCallInvite(req, memberRooms, {
      callId: call.id,
      conversationId: input.conversationId,
      fromDisplayName: currentUser.displayName,
      fromUserId: currentUser.id,
      isGroupCall,
      mode: input.mode,
      participantNames: getCallParticipantNames(conversation?.members ?? []),
    });
    logCallDebug('create-invite-emitted', {
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      memberRooms,
    });

    void (async () => {
      if (!(await isCallStillActive(call.id))) {
        logCallDebug('create-push-skipped-ended-call', {
          callId: call.id,
          elapsedMs: Date.now() - requestStartedAt,
        });
        return;
      }

      const pendingCalleeIds = await getPendingCallInviteeUserIds(call.id, notifiableCalleeIds);

      if (pendingCalleeIds.length === 0) {
        logCallDebug('create-push-skipped-answered-call', {
          callId: call.id,
          elapsedMs: Date.now() - requestStartedAt,
        });
        return;
      }

      await sendIncomingCallPushToUsers({
        avatarUrl: conversation?.type === 'GROUP' ? conversation.avatarUrl ?? currentUser.avatarUrl : currentUser.avatarUrl,
        body: isGroupCall
          ? (input.mode === 'VOICE' ? 'Incoming group voice call' : 'Incoming group video call')
          : (input.mode === 'VOICE' ? 'Incoming voice call' : 'Incoming video call'),
        callId: call.id,
        conversationId: input.conversationId,
        elapsedMs: Date.now() - requestStartedAt,
        isGroupCall,
        mode: input.mode,
        participantNames: getCallParticipantNames(conversation?.members ?? []),
        ringingReceiptUrl: createCallRingingReceiptUrl(req, call.id),
        title: currentUser.displayName || currentUser.username,
        userIds: pendingCalleeIds,
      });
      logCallDebug('create-push-sent', {
        callId: call.id,
        elapsedMs: Date.now() - requestStartedAt,
      });
    })().catch((error) => {
      logCallDebug('create-push-failed', {
        callId: call.id,
        elapsedMs: Date.now() - requestStartedAt,
        message: error instanceof Error ? error.message : 'unknown',
      });
    });

    const livekit = await issueCallJoinCredentials(req, call, currentUser);
    logCallDebug('create-response', {
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      hasLiveKit: !!livekit,
    });

    res.status(201).json({ call, livekit });
  } catch (error) {
    next(error);
  }
});

callRoutes.post('/:callId/ringing', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const call = await prisma.call.findFirst({
      include: {
        conversation: {
          include: {
            members: {
              select: { userId: true },
            },
          },
        },
        participants: {
          select: { userId: true },
        },
      },
      where: {
        endedAt: null,
        id: req.params.callId,
        OR: [
          {
            conversation: {
              members: {
                some: { userId: currentUser.id },
              },
            },
          },
          {
            participants: {
              some: { userId: currentUser.id },
            },
          },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    emitCallRinging(req, call, currentUser.id);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

callRoutes.post('/:callId/answer', async (req, res, next) => {
  const requestStartedAt = Date.now();

  try {
    const currentUser = getAuthedUser(req);
    const answerClientId = getOptionalBodyString(req.body?.answerClientId);
    const answerSurface = getOptionalBodyString(req.body?.answerSurface);
    logCallDebug('answer-start', {
      answerClientId,
      answerSurface,
      callId: req.params.callId,
      userId: currentUser.id,
    });
    const call = await prisma.call.findFirst({
      include: {
        conversation: {
          include: {
            members: {
              select: { userId: true },
            },
          },
        },
        participants: {
          select: { userId: true },
        },
      },
      where: {
        endedAt: null,
        id: req.params.callId,
        OR: [
          {
            conversation: {
              members: {
                some: { userId: currentUser.id },
              },
            },
          },
          {
            participants: {
              some: { userId: currentUser.id },
            },
          },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    await prisma.callParticipant.upsert({
      create: {
        callId: call.id,
        direction: 'INCOMING',
        joinedAt: new Date(),
        userId: currentUser.id,
      },
      update: { joinedAt: new Date(), leftAt: null },
      where: {
        callId_userId: {
          callId: call.id,
          userId: currentUser.id,
        },
      },
    });
    logCallDebug('answer-participant-upserted', {
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      userId: currentUser.id,
    });

    const updatedCall = await prisma.call.findUnique({
      include: {
        conversation: {
          include: {
            members: {
              select: { userId: true },
            },
          },
        },
        participants: {
          select: { userId: true },
        },
      },
      where: { id: call.id },
    });
    const memberRooms = updatedCall ? getCallUserRooms(updatedCall) : getCallUserRooms(call);
    req.app.get('io')?.to(memberRooms).emit('call:answered', {
      answerClientId,
      answerSurface,
      callId: call.id,
      conversationId: call.conversationId,
      userId: currentUser.id,
    });
    logCallDebug('answer-event-emitted', {
      answerClientId,
      answerSurface,
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      memberRooms,
      userId: currentUser.id,
    });
    await markCallMessageReadByUser(req, call.id, call.conversationId, currentUser.id);

    const livekit = await issueCallJoinCredentials(req, updatedCall ?? call, currentUser);
    logCallDebug('answer-response', {
      callId: call.id,
      elapsedMs: Date.now() - requestStartedAt,
      hasLiveKit: !!livekit,
      userId: currentUser.id,
    });

    res.json({ call: updatedCall ?? call, livekit });
  } catch (error) {
    next(error);
  }
});

function getOptionalBodyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined;
}

callRoutes.post('/:callId/end', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const call = await prisma.call.findFirst({
      include: {
        conversation: {
          include: {
            members: {
              select: { userId: true },
            },
          },
        },
        participants: {
          select: {
            direction: true,
            joinedAt: true,
            leftAt: true,
            userId: true,
          },
        },
      },
      where: {
        id: req.params.callId,
        OR: [
          {
            conversation: {
              members: {
                some: { userId: currentUser.id },
              },
            },
          },
          {
            participants: {
              some: { userId: currentUser.id },
            },
          },
        ],
      },
    });

    if (!call) {
      throw new HttpError(404, 'Call not found');
    }

    if (call.endedAt) {
      res.json({ call });
      return;
    }

    const currentParticipant = call.participants.find((participant) => participant.userId === currentUser.id);
    const isGroupCall = call.conversation.type === 'GROUP' || call.participants.length > 2;

    if (isGroupCall && currentParticipant) {
      const currentParticipantIsActive = !!currentParticipant.joinedAt && !currentParticipant.leftAt;
      const remainingActiveParticipantCount = call.participants.filter((participant) => (
        participant.userId !== currentUser.id &&
        !!participant.joinedAt &&
        !participant.leftAt
      )).length;
      const shouldEndGroupCall = currentParticipantIsActive && remainingActiveParticipantCount < 2;

      if (!shouldEndGroupCall) {
        const updated = await prisma.call.update({
          data: {
            participants: {
              update: {
                data: { leftAt: new Date() },
                where: {
                  callId_userId: {
                    callId: call.id,
                    userId: currentUser.id,
                  },
                },
              },
            },
          },
          include: {
            participants: {
              select: {
                direction: true,
                joinedAt: true,
                leftAt: true,
                userId: true,
              },
            },
          },
          where: { id: call.id },
        });

        const memberRooms = getCallUserRooms(call);
        req.app.get('io')?.to(memberRooms).emit('call:participant-left', {
          callId: call.id,
          conversationId: call.conversationId,
          userId: currentUser.id,
        });

        res.json({ call: updated });
        return;
      }
    }

    const endedAt = new Date();
    const ended = await prisma.call.update({
      data: {
        endedAt,
        participants: {
          updateMany: {
            data: { leftAt: endedAt },
            where: {
              joinedAt: { not: null },
              leftAt: null,
            },
          },
        },
      },
      include: {
        participants: {
          select: {
            direction: true,
            joinedAt: true,
            leftAt: true,
            userId: true,
          },
        },
      },
      where: { id: call.id },
    });
    const callStatus = getCallStatus({
      endedAt: ended.endedAt,
      endedById: currentUser.id,
      participants: ended.participants,
    });
    const callMessage = await createOrUpdateCallMessage({
      callId: ended.id,
      conversationId: ended.conversationId,
      endedById: currentUser.id,
      endedAt: ended.endedAt,
      mode: ended.mode,
      participants: ended.participants,
      senderId: currentUser.id,
      startedAt: ended.startedAt,
    });
    const linkedCallMessages = await updateLinkedCallMessages({
      callId: ended.id,
      endedById: currentUser.id,
      endedAt: ended.endedAt,
      excludeMessageIds: [callMessage.id],
      mode: ended.mode,
      participants: ended.participants,
      startedAt: ended.startedAt,
    });
    if (callStatus === 'ENDED') {
      await markAnsweredCallMessageReadByParticipants(req, ended.id, ended.conversationId, ended.participants);
    }
    await updateConversationPreviewFromMessage(ended.conversationId, callMessage);

    const memberRooms = getUniqueUserRooms([
      ...call.conversation.members,
      ...call.participants,
    ]);

    req.app.get('io')?.to(memberRooms).emit('call:ended', {
      callId: call.id,
      callStatus,
      conversationId: call.conversationId,
    });
    void sendCallEndedPushToUsers({
      callId: ended.id,
      callStatus: getFinalCallStatus(callStatus),
      conversationId: ended.conversationId,
      isGroupCall,
      mode: ended.mode,
      title: currentUser.displayName,
      userIds: getUniqueUserIds([
        ...call.conversation.members,
        ...call.participants,
      ]).filter((userId) => userId !== currentUser.id),
    });
    req.app.get('io')?.to(ended.conversationId).to(memberRooms).emit('message:new', serializeMessage(callMessage));
    req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId: ended.conversationId });
    linkedCallMessages.forEach((message) => {
      const rooms = getUniqueUserRooms(message.conversation.members);

      req.app.get('io')?.to(message.conversationId).to(rooms).emit('message:new', serializeMessage(message));
      req.app.get('io')?.to(rooms).emit('conversation:updated', { conversationId: message.conversationId });
    });

    res.json({ call: ended });
  } catch (error) {
    next(error);
  }
});

function getCallUserRooms(call: {
  conversation: { members: { userId: string }[] };
  participants: { userId: string }[];
}) {
  return getUniqueUserRooms([
    ...call.conversation.members,
    ...call.participants,
  ]);
}

function emitCallRinging(req: Request, call: {
  conversation: { members: { userId: string }[] };
  conversationId: string;
  id: string;
  participants: { userId: string }[];
}, userId: string) {
  req.app.get('io')?.to(getCallUserRooms(call)).emit('call:ringing', {
    callId: call.id,
    conversationId: call.conversationId,
    userId,
  });
}

function createCallRingingReceiptUrl(req: Request, callId: string) {
  const expiresAt = Date.now() + CALL_RINGING_RECEIPT_TTL_MS;
  const host = req.get('host');

  if (!config.PUBLIC_API_URL && !host) {
    throw new HttpError(500, 'Public API URL is not configured');
  }

  const origin = config.PUBLIC_API_URL ?? `${req.protocol}://${host}`;
  const url = new URL(`/call-receipts/${encodeURIComponent(callId)}/ringing`, origin);

  url.searchParams.set('expiresAt', String(expiresAt));
  url.searchParams.set('signature', createCallRingingReceiptSignature(callId, expiresAt));
  return url.toString();
}

function createCallRingingReceiptSignature(callId: string, expiresAt: number) {
  return crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(`call-ringing:${callId}:${expiresAt}`)
    .digest('hex');
}

function isValidCallRingingReceipt(callId: string, expiresAtValue?: string, signature?: string) {
  const expiresAt = Number(expiresAtValue);

  if (
    !expiresAtValue ||
    !signature ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < Date.now() ||
    expiresAt > Date.now() + CALL_RINGING_RECEIPT_TTL_MS
  ) {
    return false;
  }

  const expected = Buffer.from(createCallRingingReceiptSignature(callId, expiresAt), 'hex');
  const received = Buffer.from(signature, 'hex');

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function getSingleQueryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function getUniqueUserRooms(users: { userId: string }[]) {
  return Array.from(new Set(users.map((item) => `user:${item.userId}`)));
}

function getUniqueUserIds(users: { userId: string }[]) {
  return Array.from(new Set(users.map((item) => item.userId)));
}

async function sendIncomingCallPushToUsers(input: {
  avatarUrl?: string | null;
  body: string;
  callId: string;
  conversationId: string;
  elapsedMs: number;
  isGroupCall?: boolean;
  mode: 'VOICE' | 'VIDEO';
  participantNames?: string[];
  ringingReceiptUrl?: string;
  title: string;
  userIds: string[];
}) {
  const userIds = Array.from(new Set(input.userIds));

  if (userIds.length === 0) {
    logCallDebug('incoming-push-skip-no-users', {
      callId: input.callId,
      elapsedMs: input.elapsedMs,
    });
    return;
  }

  const tokens = await getCachedPushTokensForUsers(userIds, true);

  logCallDebug('incoming-push-token-ready', {
    callId: input.callId,
    elapsedMs: input.elapsedMs,
    targetUserCount: userIds.length,
    ...summarizeCallPushTokens(tokens),
  });

  if (tokens.length === 0) {
    return;
  }

  await sendIncomingCallPush({
    avatarUrl: input.avatarUrl,
    body: input.body,
    callId: input.callId,
    conversationId: input.conversationId,
    isGroupCall: input.isGroupCall,
    mode: input.mode,
    participantNames: input.participantNames,
    ringingReceiptUrl: input.ringingReceiptUrl,
    title: input.title,
    tokens,
  });
}

function summarizeCallPushTokens(tokens: CallPushToken[]) {
  return tokens.reduce<Record<string, number>>((summary, token) => {
    const platformKey = `platform_${token.platform ?? 'unknown'}`;
    const providerKey = `provider_${token.provider}`;

    summary.tokenCount = (summary.tokenCount ?? 0) + 1;
    summary[platformKey] = (summary[platformKey] ?? 0) + 1;
    summary[providerKey] = (summary[providerKey] ?? 0) + 1;

    return summary;
  }, { tokenCount: 0 });
}

async function isCallStillActive(callId: string) {
  const call = await prisma.call.findUnique({
    select: { endedAt: true },
    where: { id: callId },
  });

  return !!call && !call.endedAt;
}

async function getPendingCallInviteeUserIds(callId: string, userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  const participants = await prisma.callParticipant.findMany({
    select: { userId: true },
    where: {
      callId,
      joinedAt: null,
      leftAt: null,
      userId: { in: Array.from(new Set(userIds)) },
    },
  });

  return participants.map((participant) => participant.userId);
}

function getFinalCallStatus(callStatus: string): 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED' {
  return callStatus === 'CANCELLED' ||
    callStatus === 'DECLINED' ||
    callStatus === 'MISSED'
    ? callStatus
    : 'ENDED';
}

async function sendCallEndedPushToUsers(input: {
  callId: string;
  callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED';
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'VOICE' | 'VIDEO';
  title: string;
  userIds: string[];
}) {
  if (input.userIds.length === 0) {
    return;
  }

  const pushTokens = await getCachedPushTokensForUsers(input.userIds);

  await sendCallEndedPush({
    callId: input.callId,
    callStatus: input.callStatus,
    conversationId: input.conversationId,
    isGroupCall: input.isGroupCall,
    mode: input.mode,
    title: input.title,
    tokens: pushTokens,
  });
}

async function findExistingDirectConversation(leftUserId: string, rightUserId: string) {
  const conversations = await prisma.conversation.findMany({
    orderBy: [
      { lastMessageAt: 'desc' },
      { updatedAt: 'desc' },
    ],
    select: {
      id: true,
      members: {
        select: { userId: true },
      },
    },
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: leftUserId } } },
        { members: { some: { userId: rightUserId } } },
      ],
    },
  });
  const existing = conversations.find((conversation) => {
    const memberIds = new Set(conversation.members.map((member) => member.userId));

    return memberIds.size === 2 && memberIds.has(leftUserId) && memberIds.has(rightUserId);
  }) ?? null;

  if (!existing) {
    return null;
  }

  await prisma.conversationDeletion.deleteMany({
    where: {
      conversationId: existing.id,
      userId: { in: [leftUserId, rightUserId] },
    },
  });

  return { id: existing.id };
}

function getCallParticipantNames(participants: Array<{ user?: { displayName: string; username: string } | null }>) {
  return Array.from(new Set(
    participants
      .map((participant) => participant.user?.displayName || participant.user?.username)
      .filter((name): name is string => !!name),
  ));
}

function emitIncomingCallInvite(req: Request, rooms: string[], payload: {
  autoJoin?: boolean;
  callId: string;
  conversationId: string;
  fromDisplayName: string;
  fromUserId: string;
  isGroupCall: boolean;
  mode: 'VOICE' | 'VIDEO';
  participantNames: string[];
}) {
  const io = req.app.get('io');
  const uniqueRooms = Array.from(new Set(rooms.filter(Boolean)));

  if (!io || uniqueRooms.length === 0) {
    return;
  }

  uniqueRooms.forEach((room) => {
    io.to(room).emit('call:invite', payload);
  });
}

async function createOrUpdateCallMessage(input: {
  callId: string;
  conversationId: string;
  endedById?: string;
  endedAt?: Date | null;
  messageKey?: string;
  mode: 'VOICE' | 'VIDEO';
  participants?: Array<{ direction: string; joinedAt: Date | null; userId: string }>;
  senderId: string;
  startedAt: Date;
}) {
  const { body, metadata, shouldShowDuration } = getCallMessageContent(input);
  const existing = await findCallMessageByCallId(input.conversationId, input.callId);

  if (existing) {
    const existingDeleteKey = getMessageDeleteKey(existing.metadata);
    return prisma.message.update({
      data: {
        body,
        metadata: { ...metadata, deleteKey: existingDeleteKey },
        ...(shouldShowDuration ? { status: 'READ' as const } : {}),
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
      where: { id: existing.id },
    });
  }

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        body,
        conversationId: input.conversationId,
        kind: 'CALL',
        metadata,
        senderId: input.senderId,
        ...(shouldShowDuration ? { status: 'READ' as const } : {}),
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
    });

    await recordMessageStats(tx, {
      kind: 'CALL',
      senderId: input.senderId,
    });

    return message;
  });
}

async function updateLinkedCallMessages(input: {
  callId: string;
  endedById?: string;
  endedAt?: Date | null;
  excludeMessageIds?: string[];
  mode: 'VOICE' | 'VIDEO';
  participants?: Array<{ direction: string; joinedAt: Date | null; userId: string }>;
  startedAt: Date;
}) {
  const existingMessages = await prisma.message.findMany({
    select: {
      conversationId: true,
      id: true,
      metadata: true,
    },
    where: {
      id: { notIn: input.excludeMessageIds ?? [] },
      kind: 'CALL',
      metadata: {
        path: ['callId'],
        equals: input.callId,
      },
    },
  });
  const { body, metadata, shouldShowDuration } = getCallMessageContent(input);

  return Promise.all(existingMessages.map(async (message) => {
    const updated = await prisma.message.update({
      data: {
        body,
        metadata: { ...metadata, deleteKey: getMessageDeleteKey(message.metadata) },
        ...(shouldShowDuration ? { status: 'READ' as const } : {}),
      },
      include: {
        conversation: {
          include: {
            members: {
              select: { userId: true },
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
            username: true,
          },
        },
      },
      where: { id: message.id },
    });

    await updateConversationPreviewFromMessage(updated.conversationId, updated);
    return updated;
  }));
}

function getCallMessageContent(input: {
  callId: string;
  endedById?: string;
  endedAt?: Date | null;
  messageKey?: string;
  mode: 'VOICE' | 'VIDEO';
  participants?: Array<{ direction: string; joinedAt: Date | null; userId: string }>;
  startedAt: Date;
}) {
  const callStatus = getCallStatus({
    endedAt: input.endedAt,
    endedById: input.endedById,
    participants: input.participants,
  });
  const shouldShowDuration = callStatus === 'ENDED';
  const connectedAt = shouldShowDuration ? getCallConnectedAt(input.participants, input.startedAt) : input.startedAt;
  const durationSeconds = input.endedAt && shouldShowDuration
    ? Math.max(0, Math.floor((input.endedAt.getTime() - connectedAt.getTime()) / 1000))
    : undefined;

  return {
    body: getCallMessageBody(input.mode, callStatus, durationSeconds),
    metadata: {
      callDirection: 'OUTGOING',
      callId: input.callId,
      callStatus,
      deleteKey: input.messageKey ?? createMessageDeleteKey(),
      durationSeconds,
      connectedAt: shouldShowDuration ? connectedAt.toISOString() : undefined,
      endedAt: input.endedAt?.toISOString(),
      mode: input.mode,
      startedAt: input.startedAt.toISOString(),
    },
    shouldShowDuration,
  };
}

async function updateConversationPreviewFromMessage(conversationId: string, message: {
  body: string;
  createdAt: Date;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'CALL';
  senderId: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
}) {
  await prisma.conversation.update({
    data: {
      lastMessageAt: message.createdAt,
      lastMessageBody: message.body,
      lastMessageKind: message.kind,
      lastMessageSenderId: message.senderId,
      lastMessageStatus: message.status,
      updatedAt: new Date(),
    },
    where: { id: conversationId },
  });
}

function createMessageDeleteKey() {
  return crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).padEnd(16, '0');
}

function getMessageDeleteKey(metadata: unknown) {
  return metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : createMessageDeleteKey();
}

async function markCallMessageReadByUser(req: Request, callId: string, conversationId: string, readerId: string) {
  const readAt = new Date();
  const callMessage = await findCallMessageByCallId(conversationId, callId);

  if (!callMessage || callMessage.senderId === readerId) {
    return;
  }

  await prisma.messageReceipt.upsert({
    create: {
      deliveredAt: readAt,
      messageId: callMessage.id,
      readAt,
      status: 'READ',
      userId: readerId,
    },
    update: {
      deliveredAt: readAt,
      readAt,
      status: 'READ',
    },
    where: {
      messageId_userId: {
        messageId: callMessage.id,
        userId: readerId,
      },
    },
  });

  await prisma.message.update({
    data: { status: 'READ' },
    where: { id: callMessage.id },
  });

  const conversation = await prisma.conversation.findUnique({
    include: {
      members: {
        select: { userId: true },
      },
    },
    where: { id: conversationId },
  });
  const memberRooms = conversation?.members.map((member) => `user:${member.userId}`) ?? [];

  req.app.get('io')?.to(memberRooms).emit('message:read', {
    conversationId,
    messageIds: [callMessage.id],
    readAt: readAt.toISOString(),
    readerId,
  });
  req.app.get('io')?.to(memberRooms).emit('conversation:updated', { conversationId });
}

async function findCallMessageByCallId(conversationId: string, callId: string) {
  const selectedFields = {
    id: true,
    metadata: true,
    senderId: true,
  } as const;
  const directMatch = await prisma.message.findFirst({
    orderBy: { createdAt: 'asc' },
    select: selectedFields,
    where: {
      conversationId,
      kind: 'CALL',
      metadata: {
        path: ['callId'],
        equals: callId,
      },
    },
  });

  if (directMatch) {
    return directMatch;
  }

  const callMessages = await prisma.message.findMany({
    orderBy: { createdAt: 'asc' },
    select: selectedFields,
    take: 100,
    where: {
      conversationId,
      kind: 'CALL',
    },
  });

  return callMessages.find((message) => getCallIdFromMetadata(message.metadata) === callId) ?? null;
}

function getCallIdFromMetadata(metadata: unknown) {
  return metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'callId' in metadata &&
    typeof metadata.callId === 'string'
    ? metadata.callId
    : undefined;
}

async function markAnsweredCallMessageReadByParticipants(
  req: Request,
  callId: string,
  conversationId: string,
  participants: Array<{ joinedAt: Date | null; userId: string }>,
) {
  const readerIds = Array.from(new Set(
    participants
      .filter((participant) => !!participant.joinedAt)
      .map((participant) => participant.userId),
  ));

  await Promise.all(readerIds.map((readerId) => (
    markCallMessageReadByUser(req, callId, conversationId, readerId)
  )));
}

function getCallConnectedAt(
  participants: Array<{ direction: string; joinedAt: Date | null }> | undefined,
  fallbackStartedAt: Date,
) {
  const incomingJoinTimes = (participants ?? [])
    .filter((participant) => participant.direction === 'INCOMING' && !!participant.joinedAt)
    .map((participant) => participant.joinedAt as Date)
    .sort((left, right) => left.getTime() - right.getTime());

  return incomingJoinTimes[0] ?? fallbackStartedAt;
}

function getCallStatus(input: {
  endedAt?: Date | null;
  endedById?: string;
  participants?: Array<{ direction: string; joinedAt: Date | null; userId: string }>;
}) {
  if (!input.endedAt) {
    return 'RINGING';
  }

  const wasAnswered = input.participants?.some((participant) => participant.direction === 'INCOMING' && participant.joinedAt) ?? false;

  if (wasAnswered) {
    return 'ENDED';
  }

  const caller = input.participants?.find((participant) => participant.direction === 'OUTGOING');

  if (caller?.userId === input.endedById) {
    return 'CANCELLED';
  }

  return input.endedById ? 'DECLINED' : 'MISSED';
}

function getCallMessageBody(mode: 'VOICE' | 'VIDEO', callStatus: string, durationSeconds?: number) {
  const callType = mode === 'VOICE' ? 'Voice' : 'Video';

  if (callStatus === 'CANCELLED') {
    return `Cancelled ${callType.toLowerCase()} call`;
  }

  if (callStatus === 'DECLINED') {
    return `Declined ${callType.toLowerCase()} call`;
  }

  if (callStatus === 'MISSED') {
    return `Not answered ${callType.toLowerCase()} call`;
  }

  return `${callType} call${durationSeconds === undefined ? '' : ` - ${formatCallDuration(durationSeconds)}`}`;
}

async function assertContactsOnlyCallAllowed(callerId: string, calleeIds: string[]) {
  const uniqueCalleeIds = Array.from(new Set(calleeIds.filter((calleeId) => calleeId !== callerId)));

  if (uniqueCalleeIds.length === 0) {
    return;
  }

  const restrictedCallees = await prisma.user.findMany({
    select: {
      displayName: true,
      id: true,
    },
    where: {
      id: { in: uniqueCalleeIds },
      onlyContactsCanCall: true,
    },
  });

  if (restrictedCallees.length === 0) {
    return;
  }

  const allowedContacts = await prisma.contact.findMany({
    select: {
      ownerId: true,
    },
    where: {
      contactId: callerId,
      ownerId: { in: restrictedCallees.map((callee) => callee.id) },
    },
  });
  const allowedCalleeIds = new Set(allowedContacts.map((contact) => contact.ownerId));
  const blockedCallee = restrictedCallees.find((callee) => !allowedCalleeIds.has(callee.id));

  if (!blockedCallee) {
    return;
  }

  throw new HttpError(
    403,
    `${blockedCallee.displayName} only accepts calls from contacts. Ask them to add you to their contact list before calling.`,
    { code: 'CONTACTS_ONLY_CALLS', userId: blockedCallee.id },
  );
}

function formatCallDuration(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
