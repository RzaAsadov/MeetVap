import assert from 'node:assert/strict';
import test from 'node:test';

import { appVersionsSchema, publicApiEndpointSchema } from './operationalConfig';

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

test('accepts an HTTPS Meet origin on a public API endpoint', () => {
  const endpoint = publicApiEndpointSchema.parse({
    host: 'sub.meetvap.ru',
    meetUrl: 'https://meet.meetvap.ru/',
    mode: 'relay',
    shareUrl: 'https://web.meetvap.ru/',
    url: 'https://sub.meetvap.ru',
  });

  assert.equal(endpoint.meetUrl, 'https://meet.meetvap.ru');
  assert.equal(endpoint.shareUrl, 'https://web.meetvap.ru');
});

test('rejects a share URL containing a path or using insecure HTTP', () => {
  assert.equal(publicApiEndpointSchema.safeParse({
    host: 'sub.meetvap.ru',
    mode: 'relay',
    shareUrl: 'https://web.meetvap.ru/share',
    url: 'https://sub.meetvap.ru',
  }).success, false);
  assert.equal(publicApiEndpointSchema.safeParse({
    host: 'sub.meetvap.ru',
    mode: 'relay',
    shareUrl: 'http://web.meetvap.ru',
    url: 'https://sub.meetvap.ru',
  }).success, false);
});

test('rejects a Meet URL containing a path or using insecure HTTP', () => {
  assert.equal(publicApiEndpointSchema.safeParse({
    host: 'sub.meetvap.ru',
    meetUrl: 'https://meet.meetvap.ru/room',
    mode: 'relay',
    url: 'https://sub.meetvap.ru',
  }).success, false);
  assert.equal(publicApiEndpointSchema.safeParse({
    host: 'sub.meetvap.ru',
    meetUrl: 'http://meet.meetvap.ru',
    mode: 'relay',
    url: 'https://sub.meetvap.ru',
  }).success, false);
});
