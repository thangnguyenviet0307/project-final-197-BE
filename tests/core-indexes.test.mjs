import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planIndexes, ensureCoreIndexes } from '../scripts/ensure-core-indexes.mjs';

test('core index plans distinguish missing, compatible and conflicting definitions without mutation', () => {
  const expected = [[{ email: 1 }, { unique: true }]];
  assert.equal(planIndexes(expected, [])[0].state, 'missing');
  assert.equal(planIndexes(expected, [{ name: 'email_custom', key: { email: 1 }, unique: true }])[0].state, 'present');
  assert.equal(planIndexes(expected, [{ name: 'email_1', key: { email: 1 } }])[0].state, 'conflict');
  assert.equal(planIndexes(expected, [{ name: 'email_1', key: { unrelated: 1 }, unique: true }])[0].state, 'conflict');
  const partial = [[{ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' } } }]];
  assert.equal(planIndexes(partial, [{ name: 'sku_1', key: { sku: 1 }, unique: true, sparse: true }])[0].state, 'conflict');
  assert.equal(planIndexes(partial, [{ name: 'sku_1', key: { sku: 1 }, unique: true, partialFilterExpression: { sku: { $type: 'string' } } }])[0].state, 'present');
});
test('index apply refuses absent or mismatched database confirmation before connecting', async () => {
  for (const args of [[], ['--database', 'demo', '--apply'], ['--database', 'demo', '--apply', '--confirm-database', 'other'], ['--database', 'demo', '--unknown']]) {
    await assert.rejects(ensureCoreIndexes(args, {}));
  }
});
