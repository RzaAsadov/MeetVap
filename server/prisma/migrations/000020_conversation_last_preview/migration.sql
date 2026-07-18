ALTER TABLE "Conversation" ADD COLUMN "lastMessageBody" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "lastMessageKind" "MessageKind";
ALTER TABLE "Conversation" ADD COLUMN "lastMessageSenderId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "lastMessageStatus" "MessageStatus";
ALTER TABLE "Conversation" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

