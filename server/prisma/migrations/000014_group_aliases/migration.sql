ALTER TABLE "User" ADD COLUMN "useGroupAliases" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConversationMember" ADD COLUMN "aliasName" TEXT;
ALTER TABLE "ConversationMember" ADD COLUMN "aliasPromptSeen" BOOLEAN NOT NULL DEFAULT false;
