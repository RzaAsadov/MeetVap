import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

const SHARE_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHARE_CODE_LENGTH = 22;

type ShareCodeRow = {
  publicShareCode: string | null;
};

export function createPublicShareCode() {
  let code = '';
  const bytes = crypto.randomBytes(SHARE_CODE_LENGTH);

  for (const byte of bytes) {
    code += SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length];
  }

  return code;
}

export async function ensureUserPublicShareCode(userId: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await getUserPublicShareCode(userId);

    if (existing) {
      return existing;
    }

    const nextCode = createPublicShareCode();

    await prisma.$executeRaw`
      update "User"
      set "publicShareCode" = ${nextCode}
      where "id" = ${userId} and "publicShareCode" is null
    `.catch(() => undefined);
  }

  const code = await getUserPublicShareCode(userId);

  if (!code) {
    throw new Error('Could not create public share code');
  }

  return code;
}

export async function getUserPublicShareCode(userId: string) {
  const rows = await prisma.$queryRaw<ShareCodeRow[]>`
    select "publicShareCode" from "User" where "id" = ${userId} limit 1
  `;

  return rows[0]?.publicShareCode ?? null;
}

export async function getUserPublicShareCodes(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueUserIds.length === 0) {
    return new Map<string, string>();
  }

  const rows = await prisma.$queryRaw<Array<{ id: string; publicShareCode: string | null }>>`
    select "id", "publicShareCode" from "User" where "id" in (${Prisma.join(uniqueUserIds)})
  `;
  const codes = new Map<string, string>();

  rows.forEach((row) => {
    if (row.publicShareCode) {
      codes.set(row.id, row.publicShareCode);
    }
  });

  return codes;
}
