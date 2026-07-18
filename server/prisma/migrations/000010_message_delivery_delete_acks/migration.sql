ALTER TABLE "Message" ADD COLUMN "contentPurgedAt" TIMESTAMP(3);

ALTER TABLE "MessageDeletion" ADD COLUMN "ackedAt" TIMESTAMP(3);
ALTER TABLE "MessageDeletion" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'SELF';
ALTER TABLE "MessageDeletion" ADD COLUMN "requestedById" TEXT;

UPDATE "MessageDeletion" SET "ackedAt" = "createdAt" WHERE "ackedAt" IS NULL;

CREATE TABLE "MessageContentAck" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageContentAck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageContentAck_userId_idx" ON "MessageContentAck"("userId");

CREATE UNIQUE INDEX "MessageContentAck_messageId_userId_key" ON "MessageContentAck"("messageId", "userId");

ALTER TABLE "MessageContentAck" ADD CONSTRAINT "MessageContentAck_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageContentAck" ADD CONSTRAINT "MessageContentAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
