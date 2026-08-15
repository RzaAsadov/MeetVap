import assert from 'node:assert/strict';
import test from 'node:test';

import { getPushRetryDelayMs } from './pushDeliveryPolicy';

test('retry delay is exponential, jittered, and capped', () => {
  assert.equal(getPushRetryDelayMs(1, 300, 0.5), 2_000);
  assert.equal(getPushRetryDelayMs(20, 300, 0.5), 300_000);
  assert.equal(getPushRetryDelayMs(2, 300, 0), 3_200);
  assert.equal(getPushRetryDelayMs(2, 300, 1), 4_800);
});
