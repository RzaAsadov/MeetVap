import { Router } from 'express';
import { z } from 'zod';

import { cacheUserAuthState, invalidateUserAuthCache } from '../auth';
import { config } from '../config';
import { cacheDeviceBlockState, DeviceIdentifierType, hashDeviceIdentifier, invalidateDeviceBlockState } from '../deviceAccess';
import { HttpError } from '../httpError';
import { removeUserFromLiveKitRooms } from '../livekitPool';
import { prisma } from '../prisma';
import { invalidatePushTokenCacheForUser } from '../pushTokenCache';
import { suspendUserSockets } from '../socket';

const suspendSchema = z.object({
  adminUsername: z.string().trim().min(1).max(80),
  attestationKeyIds: z.array(z.string().trim().min(10).max(512)).max(100).default([]),
  blockDevices: z.boolean().default(false),
  installationIds: z.array(z.string().trim().regex(/^[A-Za-z0-9._-]{16,64}$/)).max(100).default([]),
  reason: z.string().trim().min(1).max(2000),
});

const unblockSchema = z.object({
  adminUsername: z.string().trim().min(1).max(80),
  unblockDeviceBlockIds: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
});

export const internalModerationRoutes = Router();

internalModerationRoutes.use((req, _res, next) => {
  const configuredSecret = config.SERVER_EVENTS_INTERNAL_SECRET;
  const suppliedSecret = req.get('x-meetvap-internal-secret');

  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    next(new HttpError(403, 'Invalid internal secret'));
    return;
  }

  next();
});

internalModerationRoutes.post('/users/:userId/suspend', async (req, res, next) => {
  try {
    const input = suspendSchema.parse(req.body);
    const userId = req.params.userId;
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ select: { authVersion: true, id: true }, where: { id: userId } });

      if (!user) {
        throw new HttpError(404, 'User not found');
      }

      const [sessions, pushTokens] = await Promise.all([
        tx.session.findMany({ select: { id: true, installationId: true, platform: true, tokenHash: true }, where: { userId } }),
        tx.devicePushToken.findMany({ select: { installationId: true, platform: true }, where: { userId } }),
      ]);
      const activeCalls = await tx.call.findMany({
        select: {
          conversationId: true,
          id: true,
          participants: { select: { userId: true }, where: { leftAt: null } },
        },
        where: { endedAt: null, participants: { some: { leftAt: null, userId } } },
      });
      const selectedInstallationIds = input.blockDevices ? [...new Set(input.installationIds)] : [];
      const selectedSessionIds = sessions
        .filter((session) => session.installationId && selectedInstallationIds.includes(session.installationId))
        .map((session) => session.id);
      const linkedAttestations = input.blockDevices && selectedSessionIds.length > 0
        ? await tx.deviceAttestation.findMany({
            select: { deviceKeyId: true, platform: true },
            where: { deviceKeyId: { not: null }, sessionId: { in: selectedSessionIds } },
          })
        : [];
      const attestationKeyIds = input.blockDevices
        ? [...new Set([...input.attestationKeyIds, ...linkedAttestations.map((item) => item.deviceKeyId).filter((value): value is string => !!value)])]
        : [];
      const identifiers: Array<{ hash: string; label: string; platform?: string; type: DeviceIdentifierType }> = [
        ...selectedInstallationIds.map((value) => ({
          hash: hashDeviceIdentifier('INSTALLATION_ID', value),
          label: maskIdentifier(value),
          platform: sessions.find((session) => session.installationId === value)?.platform
            ?? pushTokens.find((token) => token.installationId === value)?.platform
            ?? undefined,
          type: 'INSTALLATION_ID' as const,
        })),
        ...attestationKeyIds.map((value) => ({
          hash: hashDeviceIdentifier('APP_ATTEST_KEY', value),
          label: maskIdentifier(value),
          platform: linkedAttestations.find((item) => item.deviceKeyId === value)?.platform,
          type: 'APP_ATTEST_KEY' as const,
        })),
      ];

      await tx.adminBlockedUser.upsert({
        create: { createdByAdminUsername: input.adminUsername, reason: input.reason, userId },
        update: { createdAt: new Date(), createdByAdminUsername: input.adminUsername, reason: input.reason },
        where: { userId },
      });
      const updatedUser = await tx.user.update({
        data: { authVersion: { increment: 1 } },
        select: { authVersion: true },
        where: { id: userId },
      });

      for (const identifier of identifiers) {
        await tx.adminDeviceBlock.upsert({
          create: {
            createdByAdminUsername: input.adminUsername,
            identifierHash: identifier.hash,
            identifierType: identifier.type,
            label: identifier.label,
            platform: identifier.platform,
            reason: input.reason,
            sourceUserId: userId,
          },
          update: {
            createdAt: new Date(),
            createdByAdminUsername: input.adminUsername,
            label: identifier.label,
            platform: identifier.platform,
            reason: input.reason,
            revokedAt: null,
            revokedByAdminUsername: null,
            sourceUserId: userId,
          },
          where: { identifierType_identifierHash: { identifierHash: identifier.hash, identifierType: identifier.type } },
        });
      }

      const [deletedSessions, deletedPushTokens] = await Promise.all([
        tx.session.deleteMany({ where: { userId } }),
        tx.devicePushToken.deleteMany({ where: { userId } }),
        tx.callParticipant.updateMany({ data: { leftAt: new Date() }, where: { leftAt: null, userId } }),
        tx.voiceRoomParticipant.updateMany({ data: { leftAt: new Date() }, where: { leftAt: null, userId } }),
        tx.liveLocationShare.updateMany({ data: { stoppedAt: new Date() }, where: { ownerId: userId, stoppedAt: null } }),
      ]);
      const directCallsToEnd = activeCalls.filter((call) => call.participants.length <= 2);

      if (directCallsToEnd.length > 0) {
        await tx.call.updateMany({
          data: { endedAt: new Date() },
          where: { id: { in: directCallsToEnd.map((call) => call.id) } },
        });
      }

      return {
        authVersion: updatedUser.authVersion,
        deviceIdentifiers: identifiers,
        endedCalls: directCallsToEnd.map((call) => ({ callId: call.id, conversationId: call.conversationId })),
        pushTokensRemoved: deletedPushTokens.count,
        sessionsRevoked: deletedSessions.count,
        tokenHashes: sessions.map((session) => session.tokenHash),
      };
    });

    await Promise.all([
      invalidateUserAuthCache(userId, result.tokenHashes),
      invalidatePushTokenCacheForUser(userId),
      ...result.deviceIdentifiers.map((identifier) => cacheDeviceBlockState(identifier.type, identifier.hash, true)),
    ]);
    await cacheUserAuthState(userId, { authVersion: result.authVersion, blocked: true, exists: true });
    const socketsDisconnected = await suspendUserSockets(req.app.get('io'), userId, input.reason);
    const liveKitParticipantsRemoved = await removeUserFromLiveKitRooms(userId);
    result.endedCalls.forEach((call) => {
      req.app.get('io')?.to(call.conversationId).emit('call:ended', {
        callId: call.callId,
        callStatus: 'ENDED',
      });
    });

    res.json({
      devicesBlocked: result.deviceIdentifiers.length,
      liveKitParticipantsRemoved,
      ok: true,
      pushTokensRemoved: result.pushTokensRemoved,
      sessionsRevoked: result.sessionsRevoked,
      socketsDisconnected,
    });
  } catch (error) {
    next(error);
  }
});

internalModerationRoutes.post('/users/:userId/unblock', async (req, res, next) => {
  try {
    const input = unblockSchema.parse(req.body);
    const userId = req.params.userId;
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ select: { authVersion: true }, where: { id: userId } });

      if (!user) {
        throw new HttpError(404, 'User not found');
      }

      await tx.adminBlockedUser.deleteMany({ where: { userId } });
      const blocks = input.unblockDeviceBlockIds.length > 0
        ? await tx.adminDeviceBlock.findMany({
            select: { id: true, identifierHash: true, identifierType: true },
            where: { id: { in: input.unblockDeviceBlockIds }, revokedAt: null, sourceUserId: userId },
          })
        : [];

      if (blocks.length > 0) {
        await tx.adminDeviceBlock.updateMany({
          data: { revokedAt: new Date(), revokedByAdminUsername: input.adminUsername },
          where: { id: { in: blocks.map((block) => block.id) } },
        });
      }

      return { authVersion: user.authVersion, blocks };
    });

    await Promise.all([
      invalidateUserAuthCache(userId),
      ...result.blocks.map((block) => invalidateDeviceBlockState(block.identifierType as DeviceIdentifierType, block.identifierHash)),
    ]);
    await cacheUserAuthState(userId, { authVersion: result.authVersion, blocked: false, exists: true });
    res.json({ devicesUnblocked: result.blocks.length, ok: true });
  } catch (error) {
    next(error);
  }
});

function maskIdentifier(value: string) {
  return value.length <= 10 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}
