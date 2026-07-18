ALTER TABLE "Conversation" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "ownerId" TEXT;

UPDATE "Conversation" AS conversation
SET "ownerId" = (
  SELECT member."userId"
  FROM "ConversationMember" AS member
  WHERE member."conversationId" = conversation."id"
  ORDER BY member."joinedAt" ASC
  LIMIT 1
)
WHERE conversation."type" = 'GROUP';

CREATE INDEX "Conversation_ownerId_idx" ON "Conversation"("ownerId");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
