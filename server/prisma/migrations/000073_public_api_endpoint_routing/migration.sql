ALTER TABLE "Session" ADD COLUMN "publicApiUrl" TEXT;
ALTER TABLE "WebPairingSession" ADD COLUMN "publicApiUrl" TEXT;
ALTER TABLE "DevicePushToken" ADD COLUMN "publicApiUrl" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "voiceRoomLivekitServerId" TEXT;

CREATE INDEX "Session_publicApiUrl_idx" ON "Session"("publicApiUrl");
CREATE INDEX "DevicePushToken_publicApiUrl_idx" ON "DevicePushToken"("publicApiUrl");
