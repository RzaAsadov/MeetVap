import assert from 'node:assert/strict';
import test from 'node:test';

import { isLiveKitServerEligibleForApiHost } from './livekitRouting';

test('direct API traffic uses only untagged LiveKit servers', () => {
  assert.equal(isLiveKitServerEligibleForApiHost({}), true);
  assert.equal(isLiveKitServerEligibleForApiHost({ clientUrlByApiHost: 'sub.meetvap.ru' }), false);
});

test('relay API traffic uses only LiveKit servers tagged for the relay host', () => {
  assert.equal(
    isLiveKitServerEligibleForApiHost({ clientUrlByApiHost: 'sub.meetvap.ru' }, 'SUB.MEETVAP.RU.'),
    true,
  );
  assert.equal(isLiveKitServerEligibleForApiHost({}, 'sub.meetvap.ru'), false);
  assert.equal(
    isLiveKitServerEligibleForApiHost({ clientUrlByApiHost: 'other.meetvap.com' }, 'sub.meetvap.ru'),
    false,
  );
});
