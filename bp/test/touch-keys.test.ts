import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchKeys } from '../src/engine/writes.ts';

// A task names a touched feature as it writes it — «Name», «Name» FR-6, any case; the row relates to the page either way.
void test('a Touches entry resolves by feature name, guillemets and requirement number aside, and each feature once', () => {
  const pages = {
    address: { p1: 'p1', p2: 'p2' },
    name: { 'Find people you know': 'p1', 'Run a challenge': 'p2' },
    content: {},
  };
  assert.deepEqual(
    touchKeys(
      ['«Find people you know» FR-6', '«find people you know» FR-10', 'Run a challenge', 'p2', '«Nowhere»'],
      pages,
    ),
    ['p1', 'p2', '«Nowhere»'],
  );
});

void test('a relation passed as an array matches the same relation printed as a JSON string', async () => {
  const { canonicalJson } = await import('../src/target/transcript.ts');
  assert.equal(canonicalJson({ Touches: '["https://a/p/1"]' }), canonicalJson({ Touches: ['https://a/p/1'] }));
  assert.notEqual(canonicalJson({ Touches: '["https://a/p/1"]' }), canonicalJson({ Touches: ['https://a/p/2'] }));
  assert.equal(canonicalJson('[not json'), JSON.stringify('[not json'));
});
