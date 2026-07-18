ALTER TABLE "Session" ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "DevicePushToken" ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Call" ADD COLUMN "livekitServerId" TEXT;

CREATE INDEX "Call_livekitServerId_endedAt_idx" ON "Call"("livekitServerId", "endedAt");
