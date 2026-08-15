ALTER TABLE "PushRelayJob"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "PushRelayJob_scope_status_nextAttemptAt_idx"
  ON "PushRelayJob"("scope", "status", "nextAttemptAt");

CREATE TABLE "PushProviderReceipt" (
  "id" TEXT NOT NULL,
  "pushJobId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "tokenId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushProviderReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushProviderReceipt_pushJobId_fkey" FOREIGN KEY ("pushJobId") REFERENCES "PushRelayJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PushProviderReceipt_provider_receiptId_key" ON "PushProviderReceipt"("provider", "receiptId");
CREATE INDEX "PushProviderReceipt_provider_status_nextAttemptAt_idx" ON "PushProviderReceipt"("provider", "status", "nextAttemptAt");
CREATE INDEX "PushProviderReceipt_pushJobId_idx" ON "PushProviderReceipt"("pushJobId");
