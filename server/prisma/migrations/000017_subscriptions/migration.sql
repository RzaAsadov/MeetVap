-- CreateEnum
CREATE TYPE "SubscriptionPlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE', 'BILLING_RETRY', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubscriptionEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateTable
CREATE TABLE "SubscriptionEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SubscriptionPlatform" NOT NULL,
    "productId" TEXT NOT NULL,
    "purchaseToken" TEXT,
    "originalTransactionId" TEXT,
    "transactionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "environment" "SubscriptionEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "willRenew" BOOLEAN NOT NULL DEFAULT true,
    "rawLatestEvent" JSONB,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionEntitlement_userId_status_expiresAt_idx" ON "SubscriptionEntitlement"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "SubscriptionEntitlement_purchaseToken_idx" ON "SubscriptionEntitlement"("purchaseToken");

-- CreateIndex
CREATE INDEX "SubscriptionEntitlement_originalTransactionId_idx" ON "SubscriptionEntitlement"("originalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEntitlement_platform_purchaseToken_key" ON "SubscriptionEntitlement"("platform", "purchaseToken");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEntitlement_platform_originalTransactionId_key" ON "SubscriptionEntitlement"("platform", "originalTransactionId");

-- AddForeignKey
ALTER TABLE "SubscriptionEntitlement" ADD CONSTRAINT "SubscriptionEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
