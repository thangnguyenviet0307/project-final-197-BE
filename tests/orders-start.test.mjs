import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { startOrder, getOrders } from '../dist/services/orders.services.js';
import { getOrdersQuerySchema, startOrderSchema } from '../dist/validations/orders.validation.js';
import { Order } from '../dist/models/orders.model.js';
import { User } from '../dist/models/users.model.js';
import { hasPermission } from '../dist/config/rolePermissions.js';
import { Permission } from '../dist/types/permissions.type.js';
const actor = { id: String(new mongoose.Types.ObjectId()), role: 'staff' };
const id = String(new mongoose.Types.ObjectId());

function harness(t) {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', async callback => callback(session));
  t.mock.method(User, 'exists', () => ({ session: async () => ({ _id: actor.id }) }));
  return session;
}
test('staff can start eligible pending orders but has no general mutation permissions', async t => {
  const session = harness(t);
  assert.equal(hasPermission('staff', Permission.OrderStart), true);
  for (const permission of [Permission.OrderCreate, Permission.OrderUpdateStatus, Permission.OrderAssign, Permission.OrderDelete]) assert.equal(hasPermission('staff', permission), false);
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(filter.orderStatus, 1);
    assert.deepEqual(filter.userId.$in.map(value => value?.toString() ?? null), [actor.id, null]);
    assert.equal(update.$set.userId.toString(), actor.id);
    assert.equal(update.$set.orderStatus, 2);
    assert.equal(options.session, session);
    return { orderStatus: 2, userId: actor.id };
  });
  assert.equal((await startOrder(actor, id)).orderStatus, 2);
});
test('staff cannot choose another handler and customers cannot start orders', async () => {
  await assert.rejects(startOrder(actor, id, id), { status: 403 });
  await assert.rejects(startOrder({ ...actor, role: 'customer' }, id), { status: 403 });
});
test('admin can select a handler and a stale/concurrent claim returns 409', async t => {
  harness(t);
  let claimed = false;
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.orderStatus, 1);
    assert.equal(filter.userId, undefined);
    assert.equal(update.$set.userId.toString(), id);
    if (claimed) return null;
    claimed = true;
    return { orderStatus: 2 };
  });
  await startOrder({ ...actor, role: 'admin' }, id, id);
  await assert.rejects(startOrder({ ...actor, role: 'admin' }, id, id), { status: 409 });
});
test('inactive handlers cannot receive an order', async t => {
  harness(t);
  t.mock.method(User, 'exists', () => ({ session() { return this; }, then(resolve) { return Promise.resolve(null).then(resolve); } }));
  await assert.rejects(startOrder(actor, id), { status: 404 });
});
test('date filters require timestamps and an ordered range', () => {
  const parsed = getOrdersQuerySchema.parse({ dateFrom: '2026-10-01T00:00:00Z', dateTo: '2026-10-02T23:59:59Z' });
  assert.ok(parsed.dateFrom instanceof Date);
  assert.equal(getOrdersQuerySchema.safeParse({ dateFrom: 'bad' }).success, false);
  assert.equal(getOrdersQuerySchema.safeParse({ dateFrom: '2026-10-03T00:00:00Z', dateTo: '2026-10-01T00:00:00Z' }).success, false);
  assert.equal(startOrderSchema.safeParse({ orderStatus: 4 }).success, false);
});
test('date bounds are combined with staff scope for both list and total', async t => {
  const dateFrom = new Date('2026-10-01T00:00:00Z');
  const dateTo = new Date('2026-10-02T23:59:59Z');
  let filter;
  const query = { sort() { return this; }, skip() { return this; }, limit() { return this; }, populate() { return this; }, then(resolve) { return Promise.resolve([]).then(resolve); } };
  t.mock.method(Order, 'find', value => { filter = value; return query; });
  t.mock.method(Order, 'countDocuments', async value => { assert.deepEqual(value, filter); return 0; });
  await getOrders(actor, { page: 1, limit: 10, dateFrom, dateTo });
  assert.deepEqual(filter.$and[1], { orderDate: { $gte: dateFrom, $lte: dateTo } });
  assert.ok(filter.$and[0].userId);
});
test('admin assignment requires a selected active staff account', async t => {
  await assert.rejects(startOrder({ ...actor, role: 'admin' }, id), { status: 400 });
  harness(t);
  t.mock.method(User, 'exists', filter => {
    assert.equal(filter.role, 'staff');
    assert.equal(filter.active, true);
    assert.equal(filter._id, id);
    return { session() { return this; }, then(resolve) { return Promise.resolve(null).then(resolve); } };
  });
  await assert.rejects(startOrder({ ...actor, role: 'admin' }, id, id), { status: 404 });
});