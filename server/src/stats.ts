import { MessageKind, Prisma } from '@prisma/client';

type StatsClient = Prisma.TransactionClient;

export async function recordMessageStats(
  db: StatsClient,
  input: { kind: MessageKind; mediaSizeBytes?: number | null; senderId: string },
) {
  const increments = getMessageKindIncrements(input.kind);
  const mediaBytes = BigInt(Math.max(0, input.mediaSizeBytes ?? 0));
  const mediaMessages = input.mediaSizeBytes && input.mediaSizeBytes > 0 ? 1 : 0;
  const imageBytes = input.kind === 'IMAGE' ? mediaBytes : 0n;
  const videoBytes = input.kind === 'VIDEO' ? mediaBytes : 0n;
  const fileBytes = input.kind === 'FILE' ? mediaBytes : 0n;
  const voiceBytes = input.kind === 'VOICE' ? mediaBytes : 0n;

  await Promise.all([
    db.$executeRaw`
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
        "voiceBytes",
        "updatedAt"
      )
      VALUES (
        1,
        1,
        ${increments.text},
        ${increments.image},
        ${increments.video},
        ${increments.file},
        ${increments.voice},
        ${increments.call},
        ${mediaMessages},
        ${mediaBytes},
        ${imageBytes},
        ${videoBytes},
        ${fileBytes},
        ${voiceBytes},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO UPDATE SET
        "totalMessages" = "AnalyticsOverview"."totalMessages" + 1,
        "textMessages" = "AnalyticsOverview"."textMessages" + ${increments.text},
        "imageMessages" = "AnalyticsOverview"."imageMessages" + ${increments.image},
        "videoMessages" = "AnalyticsOverview"."videoMessages" + ${increments.video},
        "fileMessages" = "AnalyticsOverview"."fileMessages" + ${increments.file},
        "voiceMessages" = "AnalyticsOverview"."voiceMessages" + ${increments.voice},
        "callMessages" = "AnalyticsOverview"."callMessages" + ${increments.call},
        "mediaMessages" = "AnalyticsOverview"."mediaMessages" + ${mediaMessages},
        "mediaBytes" = "AnalyticsOverview"."mediaBytes" + ${mediaBytes},
        "imageBytes" = "AnalyticsOverview"."imageBytes" + ${imageBytes},
        "videoBytes" = "AnalyticsOverview"."videoBytes" + ${videoBytes},
        "fileBytes" = "AnalyticsOverview"."fileBytes" + ${fileBytes},
        "voiceBytes" = "AnalyticsOverview"."voiceBytes" + ${voiceBytes},
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    db.$executeRaw`
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
        "voiceBytes",
        "updatedAt"
      )
      VALUES (
        ${input.senderId},
        1,
        ${increments.text},
        ${increments.image},
        ${increments.video},
        ${increments.file},
        ${increments.voice},
        ${increments.call},
        ${mediaMessages},
        ${mediaBytes},
        ${imageBytes},
        ${videoBytes},
        ${fileBytes},
        ${voiceBytes},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("userId") DO UPDATE SET
        "totalMessages" = "UserMessageStats"."totalMessages" + 1,
        "textMessages" = "UserMessageStats"."textMessages" + ${increments.text},
        "imageMessages" = "UserMessageStats"."imageMessages" + ${increments.image},
        "videoMessages" = "UserMessageStats"."videoMessages" + ${increments.video},
        "fileMessages" = "UserMessageStats"."fileMessages" + ${increments.file},
        "voiceMessages" = "UserMessageStats"."voiceMessages" + ${increments.voice},
        "callMessages" = "UserMessageStats"."callMessages" + ${increments.call},
        "mediaMessages" = "UserMessageStats"."mediaMessages" + ${mediaMessages},
        "mediaBytes" = "UserMessageStats"."mediaBytes" + ${mediaBytes},
        "imageBytes" = "UserMessageStats"."imageBytes" + ${imageBytes},
        "videoBytes" = "UserMessageStats"."videoBytes" + ${videoBytes},
        "fileBytes" = "UserMessageStats"."fileBytes" + ${fileBytes},
        "voiceBytes" = "UserMessageStats"."voiceBytes" + ${voiceBytes},
        "updatedAt" = CURRENT_TIMESTAMP
    `,
  ]);
}

function getMessageKindIncrements(kind: MessageKind) {
  return {
    call: kind === 'CALL' ? 1 : 0,
    file: kind === 'FILE' ? 1 : 0,
    image: kind === 'IMAGE' ? 1 : 0,
    text: kind === 'TEXT' ? 1 : 0,
    video: kind === 'VIDEO' ? 1 : 0,
    voice: kind === 'VOICE' ? 1 : 0,
  };
}
