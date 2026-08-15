import assert from 'node:assert/strict';
import test from 'node:test';

import { childUserSyncEventSchema } from './childUserSyncSchemas';

const snapshot = {
  appBuildNumber: 308,
  appVersion: '23.9',
  avatarUrl: null,
  childCreatedAt: '2026-08-13T10:00:00.000Z',
  childUpdatedAt: '2026-08-13T10:05:00.000Z',
  childUserId: 'child-user-1',
  deviceModel: 'Pixel 9',
  displayName: 'Example User',
  installationId: 'installation-123456789',
  lastLoginAt: '2026-08-13T10:05:00.000Z',
  lastSeenAt: '2026-08-13T10:06:00.000Z',
  latestLocale: 'en',
  latestPlatform: 'android',
  osVersion: '16',
  registrationIpAddress: '203.0.113.1',
  registrationLocale: 'en',
  registrationPlatform: 'android',
  registrationUserAgent: 'MeetVap',
  username: 'example',
};

test('accepts a child user upsert snapshot', () => {
  const event = childUserSyncEventSchema.parse({
    eventId: 'be217424-da3f-42d1-a021-20b30a695d84',
    operation: 'UPSERT',
    reason: 'REGISTERED',
    snapshot,
  });

  assert.equal(event.snapshot.childUserId, 'child-user-1');
});

test('rejects credentials and push tokens in child user snapshots', () => {
  assert.equal(childUserSyncEventSchema.safeParse({
    eventId: 'be217424-da3f-42d1-a021-20b30a695d84',
    operation: 'UPSERT',
    reason: 'REGISTERED',
    snapshot: { ...snapshot, passwordHash: 'secret', pushToken: 'secret' },
  }).success, false);
});

test('requires an identity for child user deletion', () => {
  assert.equal(childUserSyncEventSchema.safeParse({
    eventId: 'be217424-da3f-42d1-a021-20b30a695d84',
    operation: 'DELETE',
    reason: 'DELETED',
    snapshot: { childUserId: 'child-user-1' },
  }).success, true);
});
