CREATE TABLE "CallFeedback" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "ratedById" TEXT NOT NULL,
  "stars" INTEGER NOT NULL,
  "participantUserIds" JSONB NOT NULL,
  "participantCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallFeedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CallFeedback" ADD CONSTRAINT "CallFeedback_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallFeedback" ADD CONSTRAINT "CallFeedback_ratedById_fkey" FOREIGN KEY ("ratedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CallFeedback_callId_ratedById_key" ON "CallFeedback"("callId", "ratedById");
CREATE INDEX "CallFeedback_callId_idx" ON "CallFeedback"("callId");
CREATE INDEX "CallFeedback_ratedById_createdAt_idx" ON "CallFeedback"("ratedById", "createdAt");
