import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './support/index.ts';

void test('bp help lists the phase 0 commands and exits 0', () => {
  const r = run(['help']);
  assert.equal(r.code, 0);
  for (const c of ['preflight', 'runid', 'hash', 'quote', 'log', 'progress'])
    assert.match(r.out, new RegExp(`bp ${c}\\b`));
});

void test('an unknown command is a usage error, exit 2', () => {
  const r = run(['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown command "frobnicate"/);
});
