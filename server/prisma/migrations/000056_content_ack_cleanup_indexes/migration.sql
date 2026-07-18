CREATE INDEX IF NOT EXISTS "Message_content_ack_cleanup_idx"
  ON "Message"("createdAt", "id")
  WHERE "contentPurgedAt" IS NULL
    AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserClientActivity_userId_lastSeenAt_idx"
  ON "UserClientActivity"("userId", "lastSeenAt");
