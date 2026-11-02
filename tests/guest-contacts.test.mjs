import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { Customer } from '../dist/models/customers.model.js';
import { GuestContacts } from '../dist/models/guest-contacts.model.js';
import { saveGuestContact, normalizeContactPhone } from '../dist/services/guest-contacts.service.js';

const input = { email: 'guest@example.com', phone: '0901234567', recipientName: 'New recipient', street: 'New street', provinceCode: 1, wardCode: 3 };
const locality = { province: 'Province', district: '', ward: 'Ward' };
function harness(t, accounts = [], contacts = []) {
  t.mock.method(Customer, 'find', () => ({ select() { return this; }, limit() { return this; }, session: async () => accounts }));
  t.mock.method(GuestContacts, 'find', () => ({ limit() { return this; }, session: async () => contacts }));
  t.mock.method(Customer, 'create', () => assert.fail('No guest login account'));
  t.mock.method(Customer, 'findByIdAndUpdate', () => assert.fail('No anonymous account update'));
  return t.mock.method(GuestContacts, 'findOneAndUpdate', async (filter, update, options) => ({ ...filter, ...update.$setOnInsert, ...update.$set, options }));
}
test('new guest contact stores canonical address and keys in the checkout session', async t => {
  const write = harness(t);
  const session = {};
  const result = await saveGuestContact(input, locality, session);
  assert.equal(result.email, input.email);
  assert.equal(result.phoneKey, input.phone);
  assert.deepEqual(result.address, { street: input.street, city: 'Ward', state: 'Province' });
  assert.equal(write.mock.calls[0].arguments[2].session, session);
  assert.equal(result.shippingAddress.addressVersion, 2);
});
for (const by of ['email', 'phone']) test(`matching ${by} preserves both existing identity keys`, async t => {
  const existing = { _id: new Types.ObjectId(), email: by === 'email' ? input.email : 'original@example.com', phone: by === 'phone' ? input.phone : '0987654321', shippingAddress: { deliveryTime: 'Morning' } };
  const write = harness(t, [], [existing]);
  const result = await saveGuestContact(input, locality, {});
  assert.equal(String(result._id), String(existing._id));
  assert.equal(result.email, existing.email);
  assert.equal(result.phone, existing.phone);
  assert.equal(result.recipientName, input.recipientName);
  assert.equal(write.mock.calls[0].arguments[1].$set.email, undefined);
  assert.equal(write.mock.calls[0].arguments[1].$set.phone, undefined);
});
test('matching registered account creates only a CRM overlay and keeps account untouched', async t => {
  const account = { _id: new Types.ObjectId(), email: input.email, phone: input.phone, firstName: 'Original', tokenVersion: 5 };
  harness(t, [account]);
  const result = await saveGuestContact(input, locality, {});
  assert.equal(String(result._id), String(account._id));
  assert.equal(account.firstName, 'Original');
  assert.equal(account.tokenVersion, 5);
});
test('email and phone belonging to different contacts conflict without writing', async t => {
  const write = harness(t, [], [
    { _id: new Types.ObjectId(), email: input.email, phone: '0987654321' },
    { _id: new Types.ObjectId(), email: 'other@example.com', phone: input.phone },
  ]);
  await assert.rejects(saveGuestContact(input, locality, {}), { status: 409 });
  assert.equal(write.mock.callCount(), 0);
});
test('ambiguous account phone cannot choose an arbitrary customer', async t => {
  harness(t, ['one', 'two'].map(name => ({ _id: new Types.ObjectId(), email: `${name}@example.com`, phone: input.phone })));
  await assert.rejects(saveGuestContact(input, locality, {}), { status: 409 });
});
test('guest email is required and Vietnamese phone aliases normalize consistently', async t => {
  const write = harness(t);
  await assert.rejects(saveGuestContact({ ...input, email: undefined }, locality, {}), { status: 400 });
  assert.equal(write.mock.callCount(), 0);
  assert.equal(normalizeContactPhone('+84 901-234-567'), input.phone);
});
