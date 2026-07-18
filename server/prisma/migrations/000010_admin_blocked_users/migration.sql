CREATE TABLE IF NOT EXISTS "AdminBlockedUser" (
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminBlockedUser_pkey" PRIMARY KEY ("userId")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'AdminBlockedUser_userId_fkey'
    ) THEN
        ALTER TABLE "AdminBlockedUser"
        ADD CONSTRAINT "AdminBlockedUser_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
