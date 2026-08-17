DROP INDEX IF EXISTS "DevicePushToken_token_key";

CREATE UNIQUE INDEX "DevicePushToken_userId_token_provider_key"
ON "DevicePushToken"("userId", "token", "provider");
