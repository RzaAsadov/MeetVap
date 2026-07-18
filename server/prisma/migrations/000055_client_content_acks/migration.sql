CREATE TABLE IF NOT EXISTS "MessageClientAck" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "client" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageClientAck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MessageClientAck_messageId_userId_client_key"
  ON "MessageClientAck"("messageId", "userId", "client");

CREATE INDEX IF NOT EXISTS "MessageClientAck_userId_client_createdAt_idx"
  ON "MessageClientAck"("userId", "client", "createdAt");

CREATE INDEX IF NOT EXISTS "MessageClientAck_messageId_idx"
  ON "MessageClientAck"("messageId");

ALTER TABLE "MessageClientAck"
  ADD CONSTRAINT "MessageClientAck_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageClientAck"
  ADD CONSTRAINT "MessageClientAck_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "UserClientActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "client" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserClientActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserClientActivity_userId_client_key"
  ON "UserClientActivity"("userId", "client");

CREATE INDEX IF NOT EXISTS "UserClientActivity_client_lastSeenAt_idx"
  ON "UserClientActivity"("client", "lastSeenAt");

ALTER TABLE "UserClientActivity"
  ADD CONSTRAINT "UserClientActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
