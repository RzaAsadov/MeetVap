ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "publicInviteCode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_publicInviteCode_key" ON "Conversation"("publicInviteCode");
CREATE INDEX IF NOT EXISTS "Conversation_publicInviteCode_idx" ON "Conversation"("publicInviteCode");
