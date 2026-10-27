import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairPhoneIndexes } from '../scripts/repair-customer-phone-index.mjs';

function fixture() {
  let indexes = [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'email_1', key: { email: 1 }, unique: true },
    { name: 'accountId_1', key: { accountId: 1 }, unique: true, sparse: true },
    { name: 'phone_1', key: { phone: 1 }, unique: true },
    { name: 'other_phone', key: { phone: 1, isActive: 1 } },
  ];
  const dropped = [];
  return { dropped, collection: {
    indexes: async () => indexes,
    dropIndex: async name => { dropped.push(name); indexes = indexes.filter(index => index.name !== name); },
    createIndex: async (key, options) => {
      assert.deepEqual(key, { phone: 1 });
      assert.deepEqual(options, { name: 'phone_1' });
      if (!indexes.some(index => index.name === options.name)) indexes.push({ name: options.name, key });
    },
  } };
}

test('default inspection never changes database indexes', async () => {
  const { collection, dropped } = fixture();
  const result = await repairPhoneIndexes(collection);
  assert.equal(result.applied, false);
  assert.equal(result.legacy.length, 1);
  assert.deepEqual(dropped, []);
});

test('repair changes only the unique phone index and is safe to repeat', async () => {
  const { collection, dropped } = fixture();
  await repairPhoneIndexes(collection, { apply: true });
  assert.deepEqual(dropped, ['phone_1']);
  let indexes = await collection.indexes();
  assert.equal(indexes.find(index => index.name === 'email_1').unique, true);
  assert.equal(indexes.find(index => index.name === 'accountId_1').unique, true);
  assert.ok(indexes.find(index => index.name === 'other_phone'));
  assert.equal(indexes.find(index => index.name === 'phone_1').unique, undefined);
  await repairPhoneIndexes(collection, { apply: true });
  assert.deepEqual(dropped, ['phone_1']);
});
