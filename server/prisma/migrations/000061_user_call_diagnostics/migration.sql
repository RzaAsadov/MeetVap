ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "callDiagnosticMode" boolean NOT NULL DEFAULT false;
