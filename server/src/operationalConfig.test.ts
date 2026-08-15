import assert from 'node:assert/strict';
import test from 'node:test';

import { appVersionsSchema } from './operationalConfig';

test('accepts the app-version policy synchronized from a main server', () => {
  const appVersions = appVersionsSchema.parse({
    android: {
      latest: '24.0',
      minimum: '24.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.meetvap.messenger&hl=en',
    },
    ios: {
      latest: '24.0',
      minimum: '24.0',
      storeUrl: 'https://apps.apple.com/tr/app/meetvap/id6767963508',
    },
  });

  assert.equal(appVersions.android.minimum, '24.0');
  assert.equal(appVersions.ios.latest, '24.0');
});

test('rejects an invalid app store URL from synchronized policy', () => {
  assert.equal(appVersionsSchema.safeParse({
    android: { latest: '24.0', minimum: '24.0', storeUrl: 'not-a-url' },
    ios: { latest: '24.0', minimum: '24.0', storeUrl: 'https://apps.apple.com/app/example' },
  }).success, false);
});
