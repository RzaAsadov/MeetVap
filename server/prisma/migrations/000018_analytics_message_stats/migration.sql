CREATE TABLE "AnalyticsOverview" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "totalMessages" BIGINT NOT NULL DEFAULT 0,
    "textMessages" BIGINT NOT NULL DEFAULT 0,
    "imageMessages" BIGINT NOT NULL DEFAULT 0,
    "videoMessages" BIGINT NOT NULL DEFAULT 0,
    "fileMessages" BIGINT NOT NULL DEFAULT 0,
    "voiceMessages" BIGINT NOT NULL DEFAULT 0,
    "callMessages" BIGINT NOT NULL DEFAULT 0,
    "mediaMessages" BIGINT NOT NULL DEFAULT 0,
    "mediaBytes" BIGINT NOT NULL DEFAULT 0,
    "imageBytes" BIGINT NOT NULL DEFAULT 0,
    "videoBytes" BIGINT NOT NULL DEFAULT 0,
    "fileBytes" BIGINT NOT NULL DEFAULT 0,
    "voiceBytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsOverview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnalyticsOverview_singleton_check" CHECK ("id" = 1)
);

CREATE TABLE "UserMessageStats" (
    "userId" TEXT NOT NULL,
    "totalMessages" BIGINT NOT NULL DEFAULT 0,
    "textMessages" BIGINT NOT NULL DEFAULT 0,
    "imageMessages" BIGINT NOT NULL DEFAULT 0,
    "videoMessages" BIGINT NOT NULL DEFAULT 0,
    "fileMessages" BIGINT NOT NULL DEFAULT 0,
    "voiceMessages" BIGINT NOT NULL DEFAULT 0,
    "callMessages" BIGINT NOT NULL DEFAULT 0,
    "mediaMessages" BIGINT NOT NULL DEFAULT 0,
    "mediaBytes" BIGINT NOT NULL DEFAULT 0,
    "imageBytes" BIGINT NOT NULL DEFAULT 0,
    "videoBytes" BIGINT NOT NULL DEFAULT 0,
    "fileBytes" BIGINT NOT NULL DEFAULT 0,
    "voiceBytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMessageStats_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserMessageStats"
  ADD CONSTRAINT "UserMessageStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AnalyticsOverview" (
  "id",
  "totalMessages",
  "textMessages",
  "imageMessages",
  "videoMessages",
  "fileMessages",
  "voiceMessages",
  "callMessages",
  "mediaMessages",
  "mediaBytes",
  "imageBytes",
  "videoBytes",
  "fileBytes",
  "voiceBytes"
)
SELECT
  1,
  COUNT(*)::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'TEXT')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'IMAGE')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'VIDEO')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'FILE')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'VOICE')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'CALL')::BIGINT,
  COUNT(*) FILTER (WHERE m."mediaId" IS NOT NULL)::BIGINT,
  COALESCE(SUM(mf."sizeBytes"), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'IMAGE'), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'VIDEO'), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'FILE'), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'VOICE'), 0)::BIGINT
FROM "Message" m
LEFT JOIN "MediaFile" mf ON mf.id = m."mediaId";

INSERT INTO "UserMessageStats" (
  "userId",
  "totalMessages",
  "textMessages",
  "imageMessages",
  "videoMessages",
  "fileMessages",
  "voiceMessages",
  "callMessages",
  "mediaMessages",
  "mediaBytes",
  "imageBytes",
  "videoBytes",
  "fileBytes",
  "voiceBytes"
)
SELECT
  m."senderId",
  COUNT(*)::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'TEXT')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'IMAGE')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'VIDEO')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'FILE')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'VOICE')::BIGINT,
  COUNT(*) FILTER (WHERE m.kind = 'CALL')::BIGINT,
  COUNT(*) FILTER (WHERE m."mediaId" IS NOT NULL)::BIGINT,
  COALESCE(SUM(mf."sizeBytes"), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'IMAGE'), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'VIDEO'), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'FILE'), 0)::BIGINT,
  COALESCE(SUM(mf."sizeBytes") FILTER (WHERE m.kind = 'VOICE'), 0)::BIGINT
FROM "Message" m
LEFT JOIN "MediaFile" mf ON mf.id = m."mediaId"
GROUP BY m."senderId";
