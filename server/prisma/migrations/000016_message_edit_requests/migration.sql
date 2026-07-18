CREATE TABLE "MessageEditRequest" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT,
  "messageKey" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "metadata" JSONB,
  "userId" TEXT NOT NULL,
  "requestedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageEditRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageEditRequest_conversationId_messageKey_userId_key" ON "MessageEditRequest"("conversationId", "messageKey", "userId");
CREATE INDEX "MessageEditRequest_userId_idx" ON "MessageEditRequest"("userId");
CREATE INDEX "MessageEditRequest_conversationId_messageKey_idx" ON "MessageEditRequest"("conversationId", "messageKey");

ALTER TABLE "MessageEditRequest" ADD CONSTRAINT "MessageEditRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageEditRequest" ADD CONSTRAINT "MessageEditRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
