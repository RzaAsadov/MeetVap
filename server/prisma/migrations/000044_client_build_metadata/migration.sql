ALTER TABLE "Session" ADD COLUMN "appVersion" TEXT;
ALTER TABLE "Session" ADD COLUMN "appBuildNumber" INTEGER;
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_appBuildNumber_idx" ON "Session"("userId", "appBuildNumber");
ALTER TABLE "DevicePushToken" ADD COLUMN "appVersion" TEXT;
ALTER TABLE "DevicePushToken" ADD COLUMN "appBuildNumber" INTEGER;
CREATE INDEX "DevicePushToken_userId_appBuildNumber_idx" ON "DevicePushToken"("userId", "appBuildNumber");
CREATE TABLE "MessageStatusUpdate" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT,
  "messageKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "MessageStatus" NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "deliveredAckedAt" TIMESTAMP(3),
  "readAckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageStatusUpdate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessageStatusUpdate_conversationId_messageKey_userId_key" ON "MessageStatusUpdate"("conversationId", "messageKey", "userId");
CREATE INDEX "MessageStatusUpdate_userId_conversationId_idx" ON "MessageStatusUpdate"("userId", "conversationId");
CREATE INDEX "MessageStatusUpdate_conversationId_messageKey_idx" ON "MessageStatusUpdate"("conversationId", "messageKey");
ALTER TABLE "MessageStatusUpdate" ADD CONSTRAINT "MessageStatusUpdate_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageStatusUpdate" ADD CONSTRAINT "MessageStatusUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
