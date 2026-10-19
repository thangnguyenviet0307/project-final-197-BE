import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { Order } from '../dist/models/orders.model.js';
import { updateOrderDates } from '../dist/services/orders.services.js';
import { updateOrderDatesSchema } from '../dist/validations/orders.validation.js';
const id = 'a'.repeat(24);
const actor = { id, role: 'staff' };
function setup(t, status = 2) {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  t.mock.method(Order, 'findOne', filter => {
    if (actor.role === 'staff' && filter.userId) assert.equal(String(filter.userId), id);
    return { session: async () => ({ orderStatus: status, orderDate: new Date('2026-10-01T12:00:00Z') }) };
  });
}
test('date validation forbids empty edits, status/snapshot edits and malformed dates', () => {
  for (const input of [{}, { orderStatus: 4 }, { shippingDate: null }, { requireDate: 'bad' }]) assert.equal(updateOrderDatesSchema.safeParse(input).success, false);
  assert.equal(updateOrderDatesSchema.safeParse({ requireDate: null }).success, true);
});
test('staff updates only schedule fields of their own open order', async t => {
  setup(t);
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(String(filter.userId), id);
    assert.equal(filter.orderStatus, 2);
    assert.deepEqual(update, { $set: { plannedShippingDate: new Date('2026-10-20') }, $unset: { requireDate: 1 } });
    return { orderStatus: 2 };
  });
  await updateOrderDates(actor, id, { requireDate: null, plannedShippingDate: new Date('2026-10-20') });
});
test('staff cannot correct completion and schedules cannot change on final orders', async t => {
  setup(t, 4);
  await assert.rejects(updateOrderDates(actor, id, { shippingDate: new Date('2026-10-10') }), { status: 403 });
  await assert.rejects(updateOrderDates(actor, id, { requireDate: null }), { status: 409 });
});
test('dates cannot precede creation or have future completion times', async t => {
  setup(t, 4);
  const admin = { ...actor, role: 'admin' };
  await assert.rejects(updateOrderDates(admin, id, { shippingDate: new Date('2026-09-01') }), { status: 400 });
  await assert.rejects(updateOrderDates(admin, id, { shippingDate: new Date('2099-01-01') }), { status: 400 });
});
test('admin can correct completion without changing status', async t => {
  setup(t, 4);
  t.mock.method(Order, 'findOneAndUpdate', async (_filter, update) => {
    assert.deepEqual(update, { $set: { shippingDate: new Date('2026-10-10') } });
    return { orderStatus: 4 };
  });
  await updateOrderDates({ ...actor, role: 'admin' }, id, { shippingDate: new Date('2026-10-10') });
});