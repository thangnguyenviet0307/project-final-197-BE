import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Order } from '../dist/models/orders.model.js';
import { Customer } from '../dist/models/customers.model.js';
import { getOrders } from '../dist/services/orders.services.js';
import { generateOrderCode, isOrderCodeCollision } from '../dist/utils/order-code.js';
import { getOrdersQuerySchema } from '../dist/validations/orders.validation.js';
const actor = { id: 'a'.repeat(24), role: 'staff' };
function capture(t) {
  let filter;
  const query = { sort() { return this; }, skip() { return this; }, limit() { return this; }, populate() { return this; }, then(resolve) { return Promise.resolve([]).then(resolve); } };
  t.mock.method(Order, 'find', value => { filter = value; return query; });
  t.mock.method(Order, 'countDocuments', async value => { assert.deepEqual(value, filter); return 0; });
  return () => filter;
}
test('codes use six readable random characters and only code collisions are retryable', () => {
  for (let i = 0; i < 100; i++) assert.match(generateOrderCode(), /^ORD-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(isOrderCodeCollision({ code: 11000, keyPattern: { orderCode: 1 } }), true);
  assert.equal(isOrderCodeCollision({ code: 11000, keyPattern: { email: 1 } }), false);
});
test('new model documents get a fixed code on validation; legacy hydration does not invent one', async () => {
  const order = new Order({ customerId: actor.id, street: 'Street', city: 'City', state: 'State', paymentType: 1, orderItems: [{ productId: actor.id, quantity: 1, price: 10 }] });
  await order.validate();
  assert.match(order.orderCode, /^ORD-[A-HJ-NP-Z2-9]{6}$/);
  const code = order.orderCode;
  await order.validate();
  assert.equal(order.orderCode, code);
  const existing = Order.hydrate({ ...order.toObject(), orderCode: code });
  existing.orderCode = 'ORD-AAAAAA';
  assert.equal(existing.orderCode, code);
  assert.equal(Order.hydrate({ _id: actor.id }).orderCode, undefined);
  assert.ok(Order.schema.indexes().some(([keys, options]) => keys.orderCode === 1 && options.unique && options.partialFilterExpression));
});
test('search is bounded and order codes are matched literally while allowing staff to read all history', async t => {
  assert.equal(getOrdersQuerySchema.safeParse({ search: 'x'.repeat(101) }).success, false);
  const read = capture(t);
  await getOrders(actor, { page: 1, limit: 10, search: 'ord-a.*' });
  const filter = read();
  assert.deepEqual(filter.$and[0], {});
  const regex = filter.$and[1].$or[0].orderCode;
  assert.equal(regex.test('ORD-A.*'), true);
  assert.equal(regex.test('ORD-ABCDEF'), false);
});
test('phone search supports separators, snapshots and legacy customer references', async t => {
  const read = capture(t);
  t.mock.method(Customer, 'find', ({ phone }) => {
    assert.equal(phone.test('090 123-4567'), true);
    return { select() { return this; }, lean: async () => [{ _id: actor.id }] };
  });
  await getOrders(actor, { page: 1, limit: 10, search: '0901234567' });
  const matches = read().$and[1].$or;
  assert.equal(matches[1]['customerSnapshot.phone'].test('090.123.4567'), true);
  assert.deepEqual(matches[2].$and, [{ 'customerSnapshot.phone': null }, { customerId: { $in: [actor.id] } }]);
});