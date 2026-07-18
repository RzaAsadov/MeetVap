CREATE TABLE IF NOT EXISTS "RedeemCode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "createdByAdminUsername" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeemCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RedeemCode_durationMonths_check" CHECK ("durationMonths" IN (1, 3, 6, 12)),
    CONSTRAINT "RedeemCode_maxUses_check" CHECK ("maxUses" >= 1),
    CONSTRAINT "RedeemCode_usedCount_check" CHECK ("usedCount" >= 0)
);

CREATE TABLE IF NOT EXISTS "RedeemCodeUse" (
    "id" TEXT NOT NULL,
    "redeemCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entitlementId" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeemCodeUse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RedeemCode_code_key" ON "RedeemCode"("code");
CREATE INDEX IF NOT EXISTS "RedeemCode_createdAt_idx" ON "RedeemCode"("createdAt");
CREATE INDEX IF NOT EXISTS "RedeemCode_disabledAt_idx" ON "RedeemCode"("disabledAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RedeemCodeUse_redeemCodeId_userId_key" ON "RedeemCodeUse"("redeemCodeId", "userId");
CREATE INDEX IF NOT EXISTS "RedeemCodeUse_userId_idx" ON "RedeemCodeUse"("userId");
CREATE INDEX IF NOT EXISTS "RedeemCodeUse_entitlementId_idx" ON "RedeemCodeUse"("entitlementId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RedeemCodeUse_redeemCodeId_fkey'
    ) THEN
        ALTER TABLE "RedeemCodeUse"
        ADD CONSTRAINT "RedeemCodeUse_redeemCodeId_fkey"
        FOREIGN KEY ("redeemCodeId") REFERENCES "RedeemCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RedeemCodeUse_userId_fkey'
    ) THEN
        ALTER TABLE "RedeemCodeUse"
        ADD CONSTRAINT "RedeemCodeUse_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RedeemCodeUse_entitlementId_fkey'
    ) THEN
        ALTER TABLE "RedeemCodeUse"
        ADD CONSTRAINT "RedeemCodeUse_entitlementId_fkey"
        FOREIGN KEY ("entitlementId") REFERENCES "SubscriptionEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
