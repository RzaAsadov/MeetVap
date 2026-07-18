CREATE TABLE "MessagePin" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "pinnedById" TEXT NOT NULL,
  "scopeTargetId" TEXT NOT NULL,
  "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MessagePin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagePin_conversationId_messageId_scopeTargetId_key" ON "MessagePin"("conversationId", "messageId", "scopeTargetId");
CREATE INDEX "MessagePin_conversationId_pinnedAt_idx" ON "MessagePin"("conversationId", "pinnedAt");
CREATE INDEX "MessagePin_pinnedById_idx" ON "MessagePin"("pinnedById");
CREATE INDEX "MessagePin_scopeTargetId_idx" ON "MessagePin"("scopeTargetId");

ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
