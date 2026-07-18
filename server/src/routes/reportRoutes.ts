import { Router } from 'express';

import { getAuthedUser, requireAuth } from '../auth';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { reportSchema } from '../validators';

export const reportRoutes = Router();

reportRoutes.use(requireAuth);

reportRoutes.post('/', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = reportSchema.parse(req.body);
    const target = await resolveReportTarget(currentUser.id, input.targetType, input.targetId, input.conversationId);

    const report = await prisma.report.create({
      data: {
        reason: input.reason,
        reporterId: currentUser.id,
        targetGroupId: target.targetGroupId,
        targetMessageId: target.targetMessageId,
        targetReferenceId: input.targetId,
        targetType: input.targetType,
        targetUserId: target.targetUserId,
      },
      select: { id: true },
    });

    res.status(201).json({ ok: true, reportId: report.id });
  } catch (error) {
    next(error);
  }
});

async function resolveReportTarget(reporterId: string, targetType: 'USER' | 'MESSAGE' | 'GROUP', targetId: string, conversationId?: string) {
  if (targetType === 'USER') {
    if (targetId === reporterId) {
      throw new HttpError(400, 'Cannot report yourself');
    }

    const user = await prisma.user.findUnique({
      select: { id: true },
      where: { id: targetId },
    });

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    return { targetUserId: user.id };
  }

  if (targetType === 'MESSAGE') {
    const message = await prisma.message.findFirst({
      select: {
        conversationId: true,
        id: true,
        senderId: true,
      },
      where: {
        id: targetId,
        conversation: {
          members: {
            some: { userId: reporterId },
          },
        },
      },
    });

    if (message) {
      if (message.senderId === reporterId) {
        throw new HttpError(400, 'Cannot report your own message');
      }

      return { targetMessageId: message.id };
    }

    if (!conversationId) {
      throw new HttpError(404, 'Message not found');
    }

    await assertConversationMember(conversationId, reporterId);
    return {};
  }

  const group = await prisma.conversation.findFirst({
    select: { id: true },
    where: {
      id: targetId,
      members: {
        some: { userId: reporterId },
      },
      type: 'GROUP',
    },
  });

  if (!group) {
    throw new HttpError(404, 'Group not found');
  }

  return { targetGroupId: group.id };
}

async function assertConversationMember(conversationId: string, userId: string) {
  const membership = await prisma.conversationMember.findUnique({
    select: { id: true },
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  });

  if (!membership) {
    throw new HttpError(404, 'Conversation not found');
  }
}
