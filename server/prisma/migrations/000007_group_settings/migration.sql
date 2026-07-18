ALTER TABLE "Conversation" ADD COLUMN "hideMembers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN "ownerOnlyMessages" BOOLEAN NOT NULL DEFAULT false;
