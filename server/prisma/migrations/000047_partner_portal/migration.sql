CREATE TABLE IF NOT EXISTS "PartnerUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdByAdminUsername" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerUser_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RedeemCode"
    ADD COLUMN IF NOT EXISTS "createdByPartnerId" TEXT,
    ADD COLUMN IF NOT EXISTS "createdByPartnerUsername" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerUser_username_key" ON "PartnerUser"("username");
CREATE INDEX IF NOT EXISTS "PartnerUser_isActive_idx" ON "PartnerUser"("isActive");
CREATE INDEX IF NOT EXISTS "PartnerUser_createdAt_idx" ON "PartnerUser"("createdAt");
CREATE INDEX IF NOT EXISTS "RedeemCode_createdByPartnerId_idx" ON "RedeemCode"("createdByPartnerId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RedeemCode_createdByPartnerId_fkey'
    ) THEN
        ALTER TABLE "RedeemCode"
        ADD CONSTRAINT "RedeemCode_createdByPartnerId_fkey"
        FOREIGN KEY ("createdByPartnerId") REFERENCES "PartnerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
