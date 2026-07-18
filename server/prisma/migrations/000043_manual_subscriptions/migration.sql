-- Add manual subscription grants for admin-created entitlements.
ALTER TYPE "SubscriptionPlatform" ADD VALUE IF NOT EXISTS 'MANUAL';

ALTER TABLE "SubscriptionEntitlement"
  ADD COLUMN IF NOT EXISTS "manualGrantedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "manualGrantedByUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "manualGrantedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SubscriptionEntitlement_manualGrantedByAdminId_idx"
  ON "SubscriptionEntitlement"("manualGrantedByAdminId");
