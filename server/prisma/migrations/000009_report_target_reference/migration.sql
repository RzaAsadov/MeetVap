-- AlterTable
ALTER TABLE "Report" ADD COLUMN "targetReferenceId" TEXT NOT NULL DEFAULT '';

-- Backfill existing rows where a structured target exists.
UPDATE "Report"
SET "targetReferenceId" = COALESCE("targetUserId", "targetMessageId", "targetGroupId", '')
WHERE "targetReferenceId" = '';

-- CreateIndex
CREATE INDEX "Report_targetReferenceId_idx" ON "Report"("targetReferenceId");
