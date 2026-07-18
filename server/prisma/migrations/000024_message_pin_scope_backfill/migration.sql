ALTER TABLE "MessagePin" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "MessagePin" ADD COLUMN IF NOT EXISTS "scopeTargetId" TEXT;

UPDATE "MessagePin"
SET "id" = 'pin_' || md5("conversationId" || ':' || "messageId" || ':' || random()::text || ':' || clock_timestamp()::text)
WHERE "id" IS NULL OR "id" = '';

UPDATE "MessagePin"
SET "scopeTargetId" = 'ALL'
WHERE "scopeTargetId" IS NULL OR "scopeTargetId" = '';

ALTER TABLE "MessagePin" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "MessagePin" ALTER COLUMN "scopeTargetId" SET NOT NULL;

ALTER TABLE "MessagePin" DROP CONSTRAINT IF EXISTS "MessagePin_pkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MessagePin_pkey'
      AND conrelid = '"MessagePin"'::regclass
  ) THEN
    ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "MessagePin_conversationId_messageId_scopeTargetId_key"
  ON "MessagePin"("conversationId", "messageId", "scopeTargetId");

CREATE INDEX IF NOT EXISTS "MessagePin_scopeTargetId_idx" ON "MessagePin"("scopeTargetId");
