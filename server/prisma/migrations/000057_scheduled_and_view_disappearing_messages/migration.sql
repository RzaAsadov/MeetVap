CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
  "body" TEXT NOT NULL DEFAULT '',
  "mediaId" TEXT,
  "metadata" JSONB,
  "clientTimezone" TEXT,
  "sendAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sentMessageId" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduledMessage_senderId_status_sendAt_idx"
  ON "ScheduledMessage"("senderId", "status", "sendAt");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_conversationId_status_sendAt_idx"
  ON "ScheduledMessage"("conversationId", "status", "sendAt");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_status_sendAt_idx"
  ON "ScheduledMessage"("status", "sendAt");

ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage"
  ADD CONSTRAINT "ScheduledMessage_sentMessageId_fkey"
  FOREIGN KEY ("sentMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DisappearingMessageView" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "viewerId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "secondsAfterView" INTEGER NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleteAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisappearingMessageView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DisappearingMessageView_messageId_viewerId_key"
  ON "DisappearingMessageView"("messageId", "viewerId");
CREATE INDEX IF NOT EXISTS "DisappearingMessageView_viewerId_deleteAt_idx"
  ON "DisappearingMessageView"("viewerId", "deleteAt");
CREATE INDEX IF NOT EXISTS "DisappearingMessageView_deleteAt_deletedAt_idx"
  ON "DisappearingMessageView"("deleteAt", "deletedAt");
CREATE INDEX IF NOT EXISTS "DisappearingMessageView_conversationId_messageId_idx"
  ON "DisappearingMessageView"("conversationId", "messageId");

ALTER TABLE "DisappearingMessageView"
  ADD CONSTRAINT "DisappearingMessageView_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisappearingMessageView"
  ADD CONSTRAINT "DisappearingMessageView_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisappearingMessageView"
  ADD CONSTRAINT "DisappearingMessageView_viewerId_fkey"
  FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
