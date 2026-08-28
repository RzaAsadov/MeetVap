ALTER TABLE "LoginDomain"
  ADD COLUMN "isLocal" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "mainServerKeyHash" DROP NOT NULL;

-- Every domain created before this migration was configured with child relay
-- credentials. Preserve that behavior, but make newly-created rows local by
-- default from this point forward.
ALTER TABLE "LoginDomain" ALTER COLUMN "isLocal" SET DEFAULT true;

ALTER TABLE "User" ADD COLUMN "loginDomainId" TEXT;
CREATE INDEX "User_loginDomainId_idx" ON "User"("loginDomainId");
ALTER TABLE "User" ADD CONSTRAINT "User_loginDomainId_fkey"
  FOREIGN KEY ("loginDomainId") REFERENCES "LoginDomain"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AdminUser is owned by /admin and may not exist yet on a fresh installation.
-- /admin init adds the same columns and constraints after creating the table.
DO $$
BEGIN
  IF to_regclass('"AdminUser"') IS NOT NULL THEN
    ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "serverScope" TEXT NOT NULL DEFAULT 'MAIN';
    ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "scopeDomainId" TEXT;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'AdminUser_serverScope_check'
    ) THEN
      ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_serverScope_check"
        CHECK ("serverScope" IN ('MAIN', 'DOMAIN'));
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'AdminUser_scopeDomainId_fkey'
    ) THEN
      ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_scopeDomainId_fkey"
        FOREIGN KEY ("scopeDomainId") REFERENCES "LoginDomain"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
