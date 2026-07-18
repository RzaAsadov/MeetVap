const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

for (const envPath of [
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
]) {
  dotenv.config({ path: envPath });
}

const prisma = new PrismaClient();
const SYSTEM_USERNAME = 'meetvap';
const SYSTEM_DISPLAY_NAME = 'MeetVap';
const SYSTEM_AVATAR_URL = 'meetvap://logo';
const SYSTEM_PASSWORD = 'Open@rza@Rza@798';

async function main() {
  const passwordHash = await bcrypt.hash(SYSTEM_PASSWORD, 12);
  const existingSystemUser = await prisma.user.findFirst({
    where: { username: { equals: SYSTEM_USERNAME, mode: 'insensitive' } },
  });
  const systemUser = existingSystemUser
    ? await prisma.user.update({
        data: {
          avatarUrl: SYSTEM_AVATAR_URL,
          displayName: SYSTEM_DISPLAY_NAME,
          hideFromSearch: true,
          hideNickname: false,
          passwordHash,
          showLastSeen: false,
          username: SYSTEM_USERNAME,
          useGroupAliases: false,
        },
        where: { id: existingSystemUser.id },
      })
    : await prisma.user.create({
        data: {
          avatarUrl: SYSTEM_AVATAR_URL,
          displayName: SYSTEM_DISPLAY_NAME,
          hideFromSearch: true,
          hideNickname: false,
          passwordHash,
          showLastSeen: false,
          username: SYSTEM_USERNAME,
          useGroupAliases: false,
        },
      });
  const users = await prisma.user.findMany({
    select: { id: true },
    where: { id: { not: systemUser.id } },
  });
  let createdConversations = 0;
  let restoredConversations = 0;

  for (const user of users) {
    const existing = await prisma.conversation.findFirst({
      select: { id: true },
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { userId: user.id } } },
          { members: { some: { userId: systemUser.id } } },
        ],
      },
    });

    if (existing) {
      const deletion = await prisma.conversationDeletion.deleteMany({
        where: {
          conversationId: existing.id,
          userId: user.id,
        },
      });
      restoredConversations += deletion.count > 0 ? 1 : 0;
      continue;
    }

    await prisma.conversation.create({
      data: {
        type: 'DIRECT',
        members: {
          create: [
            { aliasPromptSeen: true, userId: user.id },
            { aliasPromptSeen: true, userId: systemUser.id },
          ],
        },
      },
    });
    createdConversations += 1;
  }

  console.log(`MeetVap system user: ${systemUser.id}`);
  console.log(`Created direct chats: ${createdConversations}`);
  console.log(`Restored deleted direct chats: ${restoredConversations}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
