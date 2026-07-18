import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

export type ConversationListFilter = 'all' | 'groups' | 'unread';

export function parseConversationListFilter(value: unknown): ConversationListFilter {
  if (value === 'unread' || value === 'groups') {
    return value;
  }

  return 'all';
}

function buildUnreadMessageExistsSql(userId: string) {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "Message" m
      WHERE m."conversationId" = c.id
        AND m."senderId" <> ${userId}
        AND m."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "MessageDeletion" md
          WHERE md."messageId" = m.id
            AND md."userId" = ${userId}
        )
        AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
        AND (
          m.kind::text <> 'CALL'
          OR COALESCE(m.metadata->>'callStatus', '') IN ('MISSED', 'CANCELLED')
        )
    )
  `;
}

function buildVisibleConversationSql(userId: string) {
  return Prisma.sql`
    (
      c.type <> 'DIRECT'
      OR EXISTS (
        SELECT 1
        FROM "ConversationMember" other_member
        WHERE other_member."conversationId" = c.id
          AND other_member."userId" <> ${userId}
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "ConversationDeletion" cd
      WHERE cd."conversationId" = c.id
        AND cd."userId" = ${userId}
        AND cd.mode = 'BLOCKED_GROUP'
    )
  `;
}

export async function countUnreadConversationsForUser(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
    SELECT COUNT(DISTINCT c.id)::bigint AS count
    FROM "Conversation" c
    INNER JOIN "ConversationMember" cm
      ON cm."conversationId" = c.id
      AND cm."userId" = ${userId}
    WHERE ${buildVisibleConversationSql(userId)}
      AND (
        (
          c.type = 'GROUP'
          AND c."ownerId" <> ${userId}
          AND cm."aliasPromptSeen" = false
        )
        OR ${buildUnreadMessageExistsSql(userId)}
      )
  `);

  return Number(rows[0]?.count ?? 0);
}

export async function countUnreadMessagesByConversationForUser(userId: string, conversationIds: string[]) {
  const uniqueConversationIds = Array.from(new Set(conversationIds)).filter(Boolean);

  if (uniqueConversationIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await prisma.$queryRaw<Array<{ conversationId: string; unreadCount: bigint | number }>>(Prisma.sql`
    SELECT m."conversationId", COUNT(*)::bigint AS "unreadCount"
    FROM "Message" m
    INNER JOIN "ConversationMember" cm
      ON cm."conversationId" = m."conversationId"
      AND cm."userId" = ${userId}
    WHERE m."conversationId" IN (${Prisma.join(uniqueConversationIds)})
      AND m."senderId" <> ${userId}
      AND m."deletedAt" IS NULL
      AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      AND NOT EXISTS (
        SELECT 1
        FROM "MessageDeletion" md
        WHERE md."messageId" = m.id
          AND md."userId" = ${userId}
      )
      AND (
        m.kind::text <> 'CALL'
        OR COALESCE(m.metadata->>'callStatus', '') IN ('MISSED', 'CANCELLED')
      )
    GROUP BY m."conversationId"
  `);

  return new Map(rows.map((row) => [row.conversationId, Number(row.unreadCount)]));
}

export async function listUnreadConversationIdsForUser(userId: string, query = '') {
  const normalizedQuery = query.trim().slice(0, 64);

  if (!normalizedQuery) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT c.id
      FROM "Conversation" c
      INNER JOIN "ConversationMember" cm
        ON cm."conversationId" = c.id
        AND cm."userId" = ${userId}
      WHERE ${buildVisibleConversationSql(userId)}
        AND (
          (
            c.type = 'GROUP'
            AND c."ownerId" <> ${userId}
            AND cm."aliasPromptSeen" = false
          )
          OR ${buildUnreadMessageExistsSql(userId)}
        )
      ORDER BY c."updatedAt" DESC
    `);

    return rows.map((row) => row.id);
  }

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT c.id
    FROM "Conversation" c
    INNER JOIN "ConversationMember" cm
      ON cm."conversationId" = c.id
      AND cm."userId" = ${userId}
    LEFT JOIN "ConversationMember" peer
      ON peer."conversationId" = c.id
      AND peer."userId" <> ${userId}
    LEFT JOIN "User" peer_user
      ON peer_user.id = peer."userId"
    WHERE ${buildVisibleConversationSql(userId)}
      AND (
        (
          c.type = 'GROUP'
          AND c."ownerId" <> ${userId}
          AND cm."aliasPromptSeen" = false
        )
        OR ${buildUnreadMessageExistsSql(userId)}
      )
      AND (
        COALESCE(c.title, '') ILIKE ${`%${normalizedQuery}%`}
        OR COALESCE(peer_user."displayName", '') ILIKE ${`%${normalizedQuery}%`}
        OR (
          peer_user."hideNickname" = false
          AND COALESCE(peer_user.username, '') ILIKE ${`%${normalizedQuery}%`}
        )
        OR EXISTS (
          SELECT 1
          FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m."deletedAt" IS NULL
            AND COALESCE(m.body, '') ILIKE ${`%${normalizedQuery}%`}
            AND NOT EXISTS (
              SELECT 1
              FROM "MessageDeletion" md
              WHERE md."messageId" = m.id
                AND md."userId" = ${userId}
            )
        )
      )
    ORDER BY c."updatedAt" DESC
  `);

  return rows.map((row) => row.id);
}

export function buildConversationListWhere(
  userId: string,
  query: string,
  filter: ConversationListFilter,
  unreadConversationIds?: string[],
): Prisma.ConversationWhereInput {
  const normalizedQuery = query.trim().slice(0, 64);

  return {
    members: {
      some: { userId },
    },
    ...(filter === 'groups' ? { type: 'GROUP' } : {}),
    ...(filter === 'unread' && unreadConversationIds
      ? { id: { in: unreadConversationIds } }
      : {}),
    ...(normalizedQuery
      ? {
          OR: [
            {
              members: {
                some: {
                  user: {
                    OR: [
                      { displayName: { contains: normalizedQuery, mode: 'insensitive' } },
                      {
                        AND: [
                          { hideNickname: false },
                          { username: { contains: normalizedQuery, mode: 'insensitive' } },
                        ],
                      },
                    ],
                  },
                },
              },
            },
            {
              messages: {
                some: {
                  body: { contains: normalizedQuery, mode: 'insensitive' },
                  deletedAt: null,
                  deletions: {
                    none: { userId },
                  },
                  OR: [
                    { senderId: userId },
                    {
                      contentAcks: {
                        none: { userId },
                      },
                      senderId: { not: userId },
                    },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}
