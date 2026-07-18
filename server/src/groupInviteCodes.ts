import crypto from 'crypto';

import { prisma } from './prisma';

const GROUP_INVITE_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const GROUP_INVITE_CODE_LENGTH = 24;

export function createGroupInviteCode() {
  let code = '';
  const bytes = crypto.randomBytes(GROUP_INVITE_CODE_LENGTH);

  for (const byte of bytes) {
    code += GROUP_INVITE_CODE_ALPHABET[byte % GROUP_INVITE_CODE_ALPHABET.length];
  }

  return code;
}

export async function createUniqueGroupInviteCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createGroupInviteCode();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      select "id" from "Conversation" where "publicInviteCode" = ${code} limit 1
    `;

    if (rows.length === 0) {
      return code;
    }
  }

  throw new Error('Could not create group invite code');
}
