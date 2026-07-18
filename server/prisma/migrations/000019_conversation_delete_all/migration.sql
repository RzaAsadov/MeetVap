ALTER TABLE "ConversationDeletion" ADD COLUMN "requestedById" TEXT;
ALTER TABLE "ConversationDeletion" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'SELF';
ALTER TABLE "ConversationDeletion" ADD COLUMN "ackedAt" TIMESTAMP(3);

UPDATE "ConversationDeletion" SET "mode" = 'SELF', "ackedAt" = "deletedAt" WHERE "ackedAt" IS NULL;
