ALTER TABLE "User"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Session"
  ADD COLUMN "installationId" TEXT;

ALTER TABLE "DevicePushToken"
  ADD COLUMN "installationId" TEXT;

ALTER TABLE "AdminBlockedUser"
  ADD COLUMN "createdByAdminUsername" TEXT;

CREATE TABLE "AdminDeviceBlock" (
  "id" TEXT NOT NULL,
  "sourceUserId" TEXT,
  "identifierType" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "label" TEXT,
  "platform" TEXT,
  "reason" TEXT,
  "createdByAdminUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedByAdminUsername" TEXT,
  CONSTRAINT "AdminDeviceBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminDeviceBlock_sourceUserId_fkey" FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdminDeviceBlock_identifierType_identifierHash_key"
  ON "AdminDeviceBlock"("identifierType", "identifierHash");
CREATE INDEX "AdminDeviceBlock_sourceUserId_revokedAt_idx"
  ON "AdminDeviceBlock"("sourceUserId", "revokedAt");
CREATE INDEX "AdminDeviceBlock_identifierHash_revokedAt_idx"
  ON "AdminDeviceBlock"("identifierHash", "revokedAt");
CREATE INDEX "Session_installationId_idx" ON "Session"("installationId");
CREATE INDEX "DevicePushToken_installationId_idx" ON "DevicePushToken"("installationId");
