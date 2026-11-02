import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Order } from '../dist/models/orders.model.js';
import { updateOrderNote } from '../dist/services/orders.services.js';
import { updateOrderNoteSchema } from '../dist/validations/orders.validation.js';
import { errorMiddleware } from '../dist/middlewares/error.middleware.js';

const actor = { id: 'a'.repeat(24), role: 'admin', tokenVersion: 0 };
const id = 'b'.repeat(24);

test('note validation requires the original value and preserves its whitespace', () => {
  assert.equal(updateOrderNoteSchema.safeParse({ orderNote: 'New' }).success, false);
  assert.equal(updateOrderNoteSchema.safeParse({ orderNote: 'New', expectedOrderNote: null }).success, false);
  assert.equal(updateOrderNoteSchema.safeParse({ orderNote: 'New', expectedOrderNote: 'a'.repeat(2001) }).success, false);
  assert.deepEqual(updateOrderNoteSchema.parse({ orderNote: ' New ', expectedOrderNote: ' Old ' }), { orderNote: 'New', expectedOrderNote: ' Old ' });
});

test('atomic comparison permits one of two writes against the same original note', async t => {
  // Mock the atomic command boundary; this is not a real MongoDB isolation test.
  let current = 'Original';
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter._id, id);
    assert.deepEqual(filter.orderStatus, { $in: [1, 2] });
    if (filter.orderNote !== current) return null;
    current = update.$set.orderNote;
    return { orderNote: current };
  });
  t.mock.method(Order, 'exists', async () => ({ _id: id }));
  const results = await Promise.allSettled([
    updateOrderNote(actor, id, 'First', 'Original'),
    updateOrderNote(actor, id, 'Second', 'Original'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(rejected.reason.businessCode, 'ORDER_NOTE_CONFLICT');
  let responseStatus;
  let responseBody;
  const response = { status(value) { responseStatus = value; return this; }, json(value) { responseBody = value; return this; } };
  errorMiddleware(rejected.reason, {}, response, () => {});
  assert.equal(responseStatus, 409);
  assert.equal(responseBody.code, 'ORDER_NOTE_CONFLICT');
  assert.equal(current, 'First');
});

test('empty expected note matches legacy missing/null values atomically', async t => {
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter.$or, [{ orderNote: '' }, { orderNote: null }]);
    return update.$set;
  });
  assert.equal((await updateOrderNote(actor, id, 'First note', '')).orderNote, 'First note');
});

test('missing, closed or inaccessible orders remain hidden behind scoped 404', async t => {
  t.mock.method(Order, 'findOneAndUpdate', async () => null);
  t.mock.method(Order, 'exists', async filter => {
    assert.equal(filter.userId.toString(), actor.id);
    assert.deepEqual(filter.orderStatus, { $in: [1, 2] });
    return null;
  });
  await assert.rejects(updateOrderNote({ ...actor, role: 'staff' }, id, 'New', 'Old'), { status: 404 });
});
