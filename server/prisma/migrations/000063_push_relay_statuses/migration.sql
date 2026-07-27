CREATE TABLE "PushRelayJob" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "remoteRelayId" TEXT,
    "domainId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidTokenIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "receivedTokenIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushRelayJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushRelaySyncState" (
    "id" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushRelaySyncState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushRelayStatusEvent" (
    "id" BIGSERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushRelayStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushRelayJob_scope_requestId_key" ON "PushRelayJob"("scope", "requestId");
CREATE INDEX "PushRelayJob_scope_status_updatedAt_idx" ON "PushRelayJob"("scope", "status", "updatedAt");
CREATE INDEX "PushRelayJob_domainId_updatedAt_id_idx" ON "PushRelayJob"("domainId", "updatedAt", "id");
CREATE INDEX "PushRelayJob_remoteRelayId_idx" ON "PushRelayJob"("remoteRelayId");
CREATE INDEX "PushRelayStatusEvent_domainId_id_idx" ON "PushRelayStatusEvent"("domainId", "id");
CREATE INDEX "PushRelayStatusEvent_jobId_idx" ON "PushRelayStatusEvent"("jobId");

ALTER TABLE "PushRelayStatusEvent"
ADD CONSTRAINT "PushRelayStatusEvent_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "PushRelayJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
