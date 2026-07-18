CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx"
  ON "Conversation"("updatedAt");

CREATE INDEX IF NOT EXISTS "Message_conversationId_deletedAt_createdAt_idx"
  ON "Message"("conversationId", "deletedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_senderId_status_createdAt_idx"
  ON "Message"("senderId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_visible_conversation_createdAt_idx"
  ON "Message"("conversationId", "createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Message_unread_conversation_sender_createdAt_idx"
  ON "Message"("conversationId", "senderId", "createdAt")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Message_purged_body_cleanup_idx"
  ON "Message"("updatedAt", "id")
  WHERE "contentPurgedAt" IS NOT NULL
    AND "body" <> ''
    AND "kind" <> 'CALL';

CREATE INDEX IF NOT EXISTS "Message_expired_media_cleanup_idx"
  ON "Message"("createdAt", "id")
  WHERE "kind" IN ('IMAGE', 'VIDEO', 'FILE', 'VOICE');

CREATE INDEX IF NOT EXISTS "Message_expired_text_cleanup_idx"
  ON "Message"("createdAt", "id")
  WHERE "kind" = 'TEXT';

CREATE INDEX IF NOT EXISTS "MessageReceipt_userId_status_idx"
  ON "MessageReceipt"("userId", "status");

CREATE INDEX IF NOT EXISTS "MessageStatusUpdate_userId_conversationId_status_updatedAt_idx"
  ON "MessageStatusUpdate"("userId", "conversationId", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "MessageStatusUpdate_pending_delivery_idx"
  ON "MessageStatusUpdate"("userId", "conversationId", "updatedAt")
  WHERE "deliveredAckedAt" IS NULL
    AND "status" = 'DELIVERED';

CREATE INDEX IF NOT EXISTS "MessageStatusUpdate_pending_read_idx"
  ON "MessageStatusUpdate"("userId", "conversationId", "updatedAt")
  WHERE "readAckedAt" IS NULL
    AND "status" = 'READ';

CREATE INDEX IF NOT EXISTS "MessageStatusUpdate_readAckedAt_idx"
  ON "MessageStatusUpdate"("readAckedAt");

CREATE INDEX IF NOT EXISTS "MessageStatusUpdate_deliveredAckedAt_readAt_idx"
  ON "MessageStatusUpdate"("deliveredAckedAt", "readAt");

CREATE INDEX IF NOT EXISTS "CallParticipant_callId_leftAt_idx"
  ON "CallParticipant"("callId", "leftAt");

CREATE INDEX IF NOT EXISTS "Call_active_livekit_idx"
  ON "Call"("livekitServerId", "id")
  WHERE "endedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Meeting_active_livekit_idx"
  ON "Meeting"("livekitServerId", "id")
  WHERE "endedAt" IS NULL
    AND "status" = 'ACTIVE';
