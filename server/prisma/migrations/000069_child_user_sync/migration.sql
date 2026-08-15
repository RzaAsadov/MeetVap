ALTER TABLE "Session"
  ADD COLUMN "deviceModel" TEXT,
  ADD COLUMN "osVersion" TEXT;

ALTER TABLE "DevicePushToken"
  ADD COLUMN "deviceModel" TEXT,
  ADD COLUMN "osVersion" TEXT;

CREATE TABLE "ChildServerUser" (
  "id" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "childUserId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "registrationLocale" TEXT,
  "registrationPlatform" TEXT,
  "registrationIpAddress" TEXT,
  "registrationUserAgent" TEXT,
  "latestLocale" TEXT,
  "latestPlatform" TEXT,
  "deviceModel" TEXT,
  "osVersion" TEXT,
  "appVersion" TEXT,
  "appBuildNumber" INTEGER,
  "installationId" TEXT,
  "lastLoginAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "childCreatedAt" TIMESTAMP(3) NOT NULL,
  "childUpdatedAt" TIMESTAMP(3) NOT NULL,
  "firstSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ChildServerUser_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChildServerUser_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "LoginDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChildServerUser_domainId_childUserId_key" ON "ChildServerUser"("domainId", "childUserId");
CREATE INDEX "ChildServerUser_domainId_username_idx" ON "ChildServerUser"("domainId", "username");
CREATE INDEX "ChildServerUser_domainId_lastLoginAt_idx" ON "ChildServerUser"("domainId", "lastLoginAt");
CREATE INDEX "ChildServerUser_domainId_lastSeenAt_idx" ON "ChildServerUser"("domainId", "lastSeenAt");

CREATE TABLE "ChildUserSyncEvent" (
  "id" TEXT NOT NULL,
  "childUserId" TEXT NOT NULL,
  "operation" TEXT NOT NULL DEFAULT 'UPSERT',
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChildUserSyncEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChildUserSyncEvent_status_nextAttemptAt_idx" ON "ChildUserSyncEvent"("status", "nextAttemptAt");
CREATE INDEX "ChildUserSyncEvent_childUserId_createdAt_idx" ON "ChildUserSyncEvent"("childUserId", "createdAt");

CREATE TABLE "ChildUserSyncState" (
  "id" TEXT NOT NULL,
  "cursorUpdatedAt" TIMESTAMP(3),
  "cursorUserId" TEXT,
  "lastCompletedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChildUserSyncState_pkey" PRIMARY KEY ("id")
);
