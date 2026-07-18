CREATE TABLE "MessageDeleteRequest" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestedById" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'ALL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageDeleteRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageDeleteRequest_conversationId_messageKey_userId_key" ON "MessageDeleteRequest"("conversationId", "messageKey", "userId");
CREATE INDEX "MessageDeleteRequest_userId_idx" ON "MessageDeleteRequest"("userId");
CREATE INDEX "MessageDeleteRequest_conversationId_messageKey_idx" ON "MessageDeleteRequest"("conversationId", "messageKey");

ALTER TABLE "MessageDeleteRequest" ADD CONSTRAINT "MessageDeleteRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageDeleteRequest" ADD CONSTRAINT "MessageDeleteRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
