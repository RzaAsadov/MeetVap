ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "diagnosticMode" boolean NOT NULL DEFAULT false;
