ALTER TABLE "Conversation" ADD COLUMN "showAdmins" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ConversationMember" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ConversationMember" AS member
SET "isAdmin" = true
FROM "Conversation" AS conversation
WHERE conversation.id = member."conversationId"
  AND conversation.type = 'GROUP'
  AND conversation."ownerId" = member."userId";
