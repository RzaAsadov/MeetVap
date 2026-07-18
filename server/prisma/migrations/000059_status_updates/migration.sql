CREATE TYPE "StatusKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

CREATE TYPE "StatusAudience" AS ENUM ('CONTACTS', 'CONTACTS_EXCEPT', 'ONLY_SHARE_WITH');

CREATE TABLE "StatusUpdate" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "kind" "StatusKind" NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "mediaId" TEXT,
  "backgroundColor" TEXT,
  "audience" "StatusAudience" NOT NULL DEFAULT 'CONTACTS',
  "exceptUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "onlyUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "StatusUpdate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StatusView" (
  "id" TEXT NOT NULL,
  "statusId" TEXT NOT NULL,
  "viewerId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StatusView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StatusUpdate_authorId_createdAt_idx" ON "StatusUpdate"("authorId", "createdAt");
CREATE INDEX "StatusUpdate_deletedAt_expiresAt_idx" ON "StatusUpdate"("deletedAt", "expiresAt");
CREATE INDEX "StatusUpdate_mediaId_idx" ON "StatusUpdate"("mediaId");
CREATE INDEX "StatusView_viewerId_viewedAt_idx" ON "StatusView"("viewerId", "viewedAt");
CREATE UNIQUE INDEX "StatusView_statusId_viewerId_key" ON "StatusView"("statusId", "viewerId");

ALTER TABLE "StatusUpdate" ADD CONSTRAINT "StatusUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusUpdate" ADD CONSTRAINT "StatusUpdate_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StatusView" ADD CONSTRAINT "StatusView_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "StatusUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusView" ADD CONSTRAINT "StatusView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
