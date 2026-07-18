-- CreateTable
CREATE TABLE "ConversationDeletion" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationDeletion_userId_idx" ON "ConversationDeletion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationDeletion_conversationId_userId_key" ON "ConversationDeletion"("conversationId", "userId");

-- AddForeignKey
ALTER TABLE "ConversationDeletion" ADD CONSTRAINT "ConversationDeletion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationDeletion" ADD CONSTRAINT "ConversationDeletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
