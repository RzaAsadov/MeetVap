ALTER TABLE "User" ALTER COLUMN "useGroupAliases" SET DEFAULT true;
UPDATE "User" SET "useGroupAliases" = true WHERE "useGroupAliases" = false;
