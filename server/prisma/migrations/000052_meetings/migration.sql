CREATE TYPE "MeetingStatus" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "MeetingParticipantRole" AS ENUM ('HOST', 'GUEST');

CREATE TABLE "Meeting" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "mode" "CallMode" NOT NULL,
  "status" "MeetingStatus" NOT NULL DEFAULT 'ACTIVE',
  "livekitRoom" TEXT,
  "livekitServerId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "maxEndsAt" TIMESTAMP(3) NOT NULL,
  "durationLimitSeconds" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingParticipant" (
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT,
  "guestId" TEXT,
  "displayName" TEXT NOT NULL,
  "role" "MeetingParticipantRole" NOT NULL DEFAULT 'GUEST',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingUsageWindow" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastEndedAt" TIMESTAMP(3),
  "consumedSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingUsageWindow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meeting_code_key" ON "Meeting"("code");
CREATE INDEX "Meeting_creatorId_startedAt_idx" ON "Meeting"("creatorId", "startedAt");
CREATE INDEX "Meeting_livekitServerId_endedAt_idx" ON "Meeting"("livekitServerId", "endedAt");
CREATE INDEX "Meeting_status_maxEndsAt_idx" ON "Meeting"("status", "maxEndsAt");

CREATE INDEX "MeetingParticipant_meetingId_leftAt_idx" ON "MeetingParticipant"("meetingId", "leftAt");
CREATE INDEX "MeetingParticipant_userId_idx" ON "MeetingParticipant"("userId");
CREATE INDEX "MeetingParticipant_guestId_idx" ON "MeetingParticipant"("guestId");

CREATE UNIQUE INDEX "MeetingUsageWindow_creatorId_key" ON "MeetingUsageWindow"("creatorId");
CREATE INDEX "MeetingUsageWindow_lastEndedAt_idx" ON "MeetingUsageWindow"("lastEndedAt");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingUsageWindow" ADD CONSTRAINT "MeetingUsageWindow_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
