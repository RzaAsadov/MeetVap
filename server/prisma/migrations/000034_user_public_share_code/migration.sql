ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicShareCode" TEXT;

UPDATE "User"
SET "publicShareCode" = substr(md5(random()::text || clock_timestamp()::text || "id") || md5("id" || random()::text), 1, 22)
WHERE "publicShareCode" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_publicShareCode_key" ON "User"("publicShareCode");
CREATE INDEX IF NOT EXISTS "User_publicShareCode_idx" ON "User"("publicShareCode");
