import assert from 'node:assert/strict';
import test from 'node:test';

import { getMeetingCodeFromUrl } from './meetingLinks';

test('parses direct and relay Meet frontend links', () => {
  assert.equal(getMeetingCodeFromUrl('https://meet.meetvap.com/AbCd1234'), 'AbCd1234');
  assert.equal(getMeetingCodeFromUrl('https://meet.meetvap.ru/Ru_123-4'), 'Ru_123-4');
});

test('parses supported application meeting schemes', () => {
  assert.equal(getMeetingCodeFromUrl('meetvap://meet/AbCd1234'), 'AbCd1234');
  assert.equal(getMeetingCodeFromUrl('com.meetvap.app://meet/AbCd1234'), 'AbCd1234');
});

test('rejects unrelated hosts and malformed meeting paths', () => {
  assert.equal(getMeetingCodeFromUrl('https://example.com/AbCd1234'), null);
  assert.equal(getMeetingCodeFromUrl('http://meet.meetvap.ru/AbCd1234'), null);
  assert.equal(getMeetingCodeFromUrl('https://meet.meetvap.ru/'), null);
  assert.equal(getMeetingCodeFromUrl('https://meet.meetvap.ru/AbCd1234/extra'), null);
  assert.equal(getMeetingCodeFromUrl('https://meet.meetvap.ru/not%20a%20code'), null);
});
