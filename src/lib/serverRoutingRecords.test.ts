import assert from 'node:assert/strict';
import test from 'node:test';

import { getRoutingHostnames, parseRoutingRecord } from './serverRoutingRecords';

test('parses main routing records with optional metadata', () => {
  assert.deepEqual(parseRoutingRecord('mv=main;sub.meetvap.ru;region=russia'), {
    alias: 'main',
    hostname: 'sub.meetvap.ru',
    metadata: { region: 'russia' },
  });
});

test('keeps existing short alias records compatible', () => {
  assert.deepEqual(parseRoutingRecord('mv=kostak;sa.kostak.ru'), {
    alias: 'kostak',
    hostname: 'sa.kostak.ru',
    metadata: {},
  });
});

test('rejects unsafe host values', () => {
  assert.equal(parseRoutingRecord('mv=main;https://sub.meetvap.ru/path'), null);
  assert.equal(parseRoutingRecord('mv=main;127.0.0.1'), null);
  assert.equal(parseRoutingRecord('mv=main;sub.meetvap.ru:8443'), null);
});

test('deduplicates hostnames for the selected routing alias', () => {
  const records = [
    parseRoutingRecord('mv=main;a.meetvap.com'),
    parseRoutingRecord('mv=main;a.meetvap.com;region=eu'),
    parseRoutingRecord('mv=main;b.meetvap.com'),
    parseRoutingRecord('mv=other;c.meetvap.com'),
  ].filter((record): record is NonNullable<typeof record> => !!record);

  assert.deepEqual(getRoutingHostnames(records, 'main'), ['a.meetvap.com', 'b.meetvap.com']);
});
