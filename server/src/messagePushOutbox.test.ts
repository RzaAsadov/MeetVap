import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/meetvap_test';
process.env.JWT_SECRET ??= 'test-only-message-push-outbox-secret';

const pushNotificationsModule = import('./pushNotifications');

test('message push tokens prefer one native destination per user installation', async () => {
  const { selectPreferredMessagePushTokens } = await pushNotificationsModule;
  const selected = selectPreferredMessagePushTokens([
    token('expo-old', 'expo', 'android', 'user-a', 'phone-1', 1),
    token('fcm-old', 'fcm', 'android', 'user-a', 'phone-1', 2),
    token('fcm-new', 'fcm', 'android', 'user-a', 'phone-1', 3),
    token('expo-ios', 'expo', 'ios', 'user-a', 'phone-2', 4),
    token('apns-ios', 'apns', 'ios', 'user-a', 'phone-2', 5),
  ]);

  assert.deepEqual(selected.map((item) => item.token).sort(), ['apns-ios', 'fcm-new']);
});

test('message push token selection keeps separate accounts and legacy unscoped tokens', async () => {
  const { selectPreferredMessagePushTokens } = await pushNotificationsModule;
  const selected = selectPreferredMessagePushTokens([
    token('account-a', 'fcm', 'android', 'user-a', 'phone-1', 1),
    token('account-b', 'fcm', 'android', 'user-b', 'phone-1', 1),
    { provider: 'expo', token: 'legacy', userId: 'user-a' },
    { provider: 'apns_voip', token: 'call-only', userId: 'user-a' },
  ]);

  assert.deepEqual(selected.map((item) => item.token).sort(), ['account-a', 'account-b', 'legacy']);
});

function token(
  value: string,
  provider: string,
  platform: string,
  userId: string,
  installationId: string,
  updatedAt: number,
) {
  return {
    installationId,
    platform,
    provider,
    token: value,
    updatedAt: new Date(updatedAt),
    userId,
  };
}
