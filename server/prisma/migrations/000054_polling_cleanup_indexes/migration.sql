CREATE INDEX IF NOT EXISTS "ConversationDeletion_userId_mode_deletedAt_idx"
  ON "ConversationDeletion"("userId", "mode", "deletedAt");

CREATE INDEX IF NOT EXISTS "Conversation_type_disappearingMessagesDurationMinutes_updatedAt_idx"
  ON "Conversation"("type", "disappearingMessagesDurationMinutes", "updatedAt");

CREATE INDEX IF NOT EXISTS "Message_mediaId_idx"
  ON "Message"("mediaId");

CREATE INDEX IF NOT EXISTS "Message_text_location_cleanup_idx"
  ON "Message"("createdAt", "id")
  WHERE "kind" = 'TEXT'
    AND ("metadata" ? 'location' OR "metadata" ? 'liveLocation');

CREATE INDEX IF NOT EXISTS "MessageDeletion_userId_mode_ackedAt_idx"
  ON "MessageDeletion"("userId", "mode", "ackedAt");

CREATE INDEX IF NOT EXISTS "MessageDeletion_pending_all_user_idx"
  ON "MessageDeletion"("userId", "createdAt", "messageId")
  WHERE "mode" = 'ALL'
    AND "ackedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "MessageDeleteRequest_userId_conversationId_mode_idx"
  ON "MessageDeleteRequest"("userId", "conversationId", "mode");

CREATE INDEX IF NOT EXISTS "MessageEditRequest_userId_conversationId_idx"
  ON "MessageEditRequest"("userId", "conversationId");

CREATE INDEX IF NOT EXISTS "Call_endedAt_startedAt_idx"
  ON "Call"("endedAt", "startedAt");

CREATE INDEX IF NOT EXISTS "Call_stale_active_idx"
  ON "Call"("startedAt", "id")
  WHERE "endedAt" IS NULL;
