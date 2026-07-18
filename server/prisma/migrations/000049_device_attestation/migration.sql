CREATE TABLE "AttestationChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "platform" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "clientDataHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),

  CONSTRAINT "AttestationChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceAttestation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "platform" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "appVersion" TEXT,
  "appBuildNumber" INTEGER,
  "deviceKeyId" TEXT,
  "challengeId" TEXT,
  "verdict" JSONB,
  "failureReason" TEXT,
  "lastAttestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DeviceAttestation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttestationChallenge_userId_idx" ON "AttestationChallenge"("userId");
CREATE INDEX "AttestationChallenge_sessionId_idx" ON "AttestationChallenge"("sessionId");
CREATE INDEX "AttestationChallenge_expiresAt_idx" ON "AttestationChallenge"("expiresAt");

CREATE INDEX "DeviceAttestation_userId_idx" ON "DeviceAttestation"("userId");
CREATE INDEX "DeviceAttestation_sessionId_idx" ON "DeviceAttestation"("sessionId");
CREATE INDEX "DeviceAttestation_platform_status_idx" ON "DeviceAttestation"("platform", "status");
CREATE INDEX "DeviceAttestation_expiresAt_idx" ON "DeviceAttestation"("expiresAt");
CREATE INDEX "DeviceAttestation_deviceKeyId_idx" ON "DeviceAttestation"("deviceKeyId");

ALTER TABLE "AttestationChallenge"
  ADD CONSTRAINT "AttestationChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttestationChallenge"
  ADD CONSTRAINT "AttestationChallenge_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceAttestation"
  ADD CONSTRAINT "DeviceAttestation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceAttestation"
  ADD CONSTRAINT "DeviceAttestation_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
