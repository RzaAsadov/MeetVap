CREATE TABLE "LoginDomain" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "description" TEXT,
  "contacts" TEXT,
  "originIpAddresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mainServerKeyHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "maxUserCount" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByAdminUsername" TEXT,
  "updatedByAdminUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginDomain_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoginDomain_maxUserCount_check" CHECK ("maxUserCount" IS NULL OR "maxUserCount" > 0)
);

CREATE TABLE "LoginDomainUsername" (
  "id" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "platform" TEXT,
  "requestCount" INTEGER NOT NULL DEFAULT 1,
  "firstRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginDomainUsername_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoginDomain_domain_key" ON "LoginDomain"("domain");
CREATE UNIQUE INDEX "LoginDomain_mainServerKeyHash_key" ON "LoginDomain"("mainServerKeyHash");
CREATE INDEX "LoginDomain_isActive_expiresAt_idx" ON "LoginDomain"("isActive", "expiresAt");
CREATE INDEX "LoginDomain_createdAt_idx" ON "LoginDomain"("createdAt");
CREATE UNIQUE INDEX "LoginDomainUsername_domainId_username_key" ON "LoginDomainUsername"("domainId", "username");
CREATE INDEX "LoginDomainUsername_domainId_lastRequestedAt_idx" ON "LoginDomainUsername"("domainId", "lastRequestedAt");
ALTER TABLE "LoginDomainUsername" ADD CONSTRAINT "LoginDomainUsername_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "LoginDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
