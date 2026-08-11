ALTER TABLE "AttestationChallenge"
  ADD COLUMN "challengeValue" TEXT,
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "deviceKeyId" TEXT;

CREATE TABLE "AppAttestKey" (
  "id" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "installationId" TEXT,
  "publicKeyPem" TEXT NOT NULL,
  "receiptBase64" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "signCount" INTEGER NOT NULL DEFAULT 0,
  "appVersion" TEXT,
  "appBuildNumber" INTEGER,
  "lastAssertedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppAttestKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppAttestKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppAttestKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AppAttestKey_keyId_key" ON "AppAttestKey"("keyId");
CREATE INDEX "AppAttestKey_userId_revokedAt_idx" ON "AppAttestKey"("userId", "revokedAt");
CREATE INDEX "AppAttestKey_sessionId_idx" ON "AppAttestKey"("sessionId");
CREATE INDEX "AppAttestKey_installationId_idx" ON "AppAttestKey"("installationId");
