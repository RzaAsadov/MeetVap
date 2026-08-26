import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicApiEndpoint, resolveMeetServerUrl, resolvePublicApiEndpointByHost, resolveShareServerUrl } from './publicApiRouting';

const direct: PublicApiEndpoint = {
  host: 'mm.meetvap.com',
  meetUrl: 'https://meet.meetvap.com',
  mode: 'direct',
  shareUrl: 'https://meetvap.com',
  url: 'https://mm.meetvap.com',
};
const relay: PublicApiEndpoint = {
  host: 'sub.meetvap.ru',
  meetUrl: 'https://meet.meetvap.ru',
  mode: 'relay',
  shareUrl: 'https://web.meetvap.ru',
  url: 'https://sub.meetvap.ru',
};
const endpoints = [direct, relay];

test('resolves the public endpoint from the preserved proxy host', () => {
  assert.equal(
    resolvePublicApiEndpointByHost(endpoints, direct, 'sub.meetvap.ru, mm.meetvap.com', 'mm.meetvap.com'),
    relay,
  );
});

test('uses the default endpoint for an unrecognized request host', () => {
  assert.equal(resolvePublicApiEndpointByHost(endpoints, direct, undefined, '127.0.0.1:4000'), direct);
});

test('selects the Meet frontend assigned to the resolved API endpoint', () => {
  assert.equal(resolveMeetServerUrl(direct, 'https://meet.example.com'), 'https://meet.meetvap.com');
  assert.equal(resolveMeetServerUrl(relay, 'https://meet.example.com'), 'https://meet.meetvap.ru');
});

test('uses the legacy Meet frontend when the API endpoint has no override', () => {
  assert.equal(
    resolveMeetServerUrl({ host: 'api.example.com', mode: 'direct', url: 'https://api.example.com' }, 'https://meet.example.com'),
    'https://meet.example.com',
  );
});

test('selects the share frontend assigned to the resolved API endpoint', () => {
  assert.equal(resolveShareServerUrl(direct), 'https://meetvap.com');
  assert.equal(resolveShareServerUrl(relay), 'https://web.meetvap.ru');
});

test('uses the primary share frontend when the endpoint has no override', () => {
  assert.equal(
    resolveShareServerUrl({ host: 'api.example.com', mode: 'direct', url: 'https://api.example.com' }),
    'https://meetvap.com',
  );
});
