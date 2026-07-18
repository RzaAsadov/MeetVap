ALTER TABLE "User"
  ADD COLUMN "registrationIpAddress" TEXT,
  ADD COLUMN "registrationLocale" TEXT,
  ADD COLUMN "registrationPlatform" TEXT,
  ADD COLUMN "registrationUserAgent" TEXT;

ALTER TABLE "Session"
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "platform" TEXT;
