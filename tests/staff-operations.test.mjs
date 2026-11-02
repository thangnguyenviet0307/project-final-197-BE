import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../dist/models/users.model.js';
import Product from '../dist/models/products.model.js';
import { Order } from '../dist/models/orders.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { updateInventory } from '../dist/services/products.service.js';
import { updateOrderStatus, updateOrderNote, startOrder, createOrder, assignOrder, getOrderById, getPersonalSales } from '../dist/services/orders.services.js';
import { updateInventorySchema } from '../dist/validations/products.validation.js';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');
let server, base;
const staffId = String(new mongoose.Types.ObjectId());
const target = String(new mongoose.Types.ObjectId());
const staff = { id: staffId, role: 'staff' };
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
function auth(t) {
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: staffId, firstName: 'Staff', lastName: 'Test', role: 'staff', active: true, tokenVersion: 0 }) }));
  return { Authorization: `Bearer ${generateAccessToken({ id: staffId, tokenVersion: 0 })}`, 'Content-Type': 'application/json' };
}
function transaction(t) {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async fn => fn({}));
}
test('staff HTTP cannot change prices, discounts, delete data, manage accounts or upload product images', async t => {
  const headers = auth(t);
  for (const [method, path, body] of [
    ['PUT', `/products/${target}`, { price: 1 }], ['POST', '/products', {}],
    ['DELETE', `/products/${target}`], ['DELETE', `/orders/${target}`],
    ['PUT', `/customers/${target}`, { firstName: 'Changed' }], ['DELETE', `/customers/${target}`],
    ['GET', '/users'], ['PATCH', `/orders/${target}/assignee`, { userId: staffId }], ['POST', `/products/${target}/images`, {}],
  ]) assert.equal((await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })).status, 403, path);
  for (const extra of [{ price: 1 }, { discount: 70 }, { is_active: false }, { variants: [{ _id: target, stock: 1, price: 1 }] }]) {
    assert.equal((await fetch(`${base}/products/${target}/inventory`, { method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: 0, stock: 1, ...extra }) })).status, 400);
  }
});
test('inventory validation rejects missing versions, negative/fractional stock, extra fields and mixed payloads', () => {
  for (const value of [{ stock: 1 }, { expectedVersion: 0, stock: -1 }, { expectedVersion: 0, stock: 1.5 }, { expectedVersion: 0, stock: 1, price: 1 }, { expectedVersion: 0, stock: 1, variants: [{ _id: target, stock: 1 }] }]) assert.equal(updateInventorySchema.safeParse(value).success, false);
});
test('inventory updates only requested variant stock and preserves prices and metadata', async t => {
  transaction(t);
  const product = new Product({ product_name: 'Phone', price: 100, discount: 10, stock: 5, __v: 3, variants: [{ sku: 'PHONE-A', price: 90, stock: 2, color: 'Black' }, { sku: 'PHONE-B', price: 100, stock: 3 }] });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  t.mock.method(product, 'save', async () => product);
  await updateInventory(target, { expectedVersion: 3, variants: [{ _id: String(product.variants[0]._id), stock: 6 }] });
  assert.equal(product.stock, 9);
  assert.equal(product.price, 100);
  assert.equal(product.discount, 10);
  assert.equal(product.variants[0].price, 90);
  assert.equal(product.variants[0].color, 'Black');
  assert.equal(product.variants[1].stock, 3);
  await assert.rejects(updateInventory(target, { expectedVersion: 2, stock: 3 }), { status: 409 });
  await assert.rejects(updateInventory(target, { expectedVersion: 3, variants: [{ _id: target, stock: 3 }] }), { status: 400 });
});
test('staff cannot mutate another handler order despite full read access', async t => {
  transaction(t);
  t.mock.method(Order, 'findOne', filter => {
    assert.equal(filter.userId.toString(), staffId);
    return { session: async () => null };
  });
  t.mock.method(Order, 'findOneAndUpdate', async filter => { assert.equal(filter.userId.toString(), staffId); return null; });
  await assert.rejects(updateOrderStatus(staff, target, { orderStatus: 2 }), { status: 404 });
  t.mock.method(Order, 'exists', async filter => { assert.equal(filter.userId.toString(), staffId); return null; });
  await assert.rejects(updateOrderNote(staff, target, 'Note', ''), { status: 404 });
});
test('personal sales always use authenticated staff ID and server monetary arithmetic', async t => {
  t.mock.method(Order, 'find', filter => {
    assert.equal(filter.userId.toString(), staffId);
    assert.equal(filter.orderStatus, 4);
    return { select() { return this; }, lean() { return this; }, cursor: async function* () {
      yield { orderItems: [{ quantity: 2, price: 100, discount: 10 }] };
      yield { orderItems: [{ quantity: 1, price: 0.1, discount: 0 }] };
    } };
  });
  assert.deepEqual(await getPersonalSales(staff), { completedOrders: 2, revenue: 180.1 });
});

test('staff can read another handler order at every status without assignment filtering', async t => {
  for (const orderStatus of [1, 2, 3, 4]) {
    const query = { populate() { return this; }, then(resolve) { return Promise.resolve({ _id: target, userId: target, orderStatus }).then(resolve); } };
    const mock = t.mock.method(Order, 'findOne', filter => { assert.deepEqual(filter, { _id: target }); return query; });
    assert.equal((await getOrderById(staff, target)).orderStatus, orderStatus);
    mock.mock.restore();
  }
});

test('accepting a sixth active order is blocked before updating the order', async t => {
  transaction(t);
  t.mock.method(User, 'exists', () => ({ session: async () => ({ _id: staffId }) }));
  t.mock.method(Order, 'countDocuments', filter => {
    assert.equal(filter.userId.toString(), staffId);
    assert.deepEqual(filter.orderStatus.$in, [1, 2]);
    assert.equal(filter._id.$ne.toString(), target);
    return { session: async () => 5 };
  });
  const write = t.mock.method(Order, 'findOneAndUpdate', async () => { throw Error('Must not update'); });
  await assert.rejects(startOrder(staff, target), { status: 409 });
  assert.equal(write.mock.callCount(), 0);
});
test('capacity also prevents bypass through creating or admin reassignment', async t => {
  transaction(t);
  t.mock.method(User, 'exists', () => ({ session: async () => ({ _id: staffId }) }));
  t.mock.method(Order, 'countDocuments', () => ({ session: async () => 5 }));
  t.mock.method(Order, 'findById', () => ({ session: async () => ({ orderStatus: 1 }) }));
  await assert.rejects(createOrder(staff, { orderItems: [] }), { status: 409 });
  await assert.rejects(assignOrder({ ...staff, role: 'admin' }, target, staffId), { status: 409 });
});
test('the fifth active order is accepted, a later sixth is blocked, and completing one frees capacity', async t => {
  transaction(t);
  let count = 4;
  t.mock.method(User, 'exists', () => ({ session: async () => ({ _id: staffId }) }));
  t.mock.method(Order, 'countDocuments', () => ({ session: async () => count }));
  t.mock.method(Order, 'findOneAndUpdate', async () => { count++; return { orderStatus: 2 }; });
  await startOrder(staff, target);
  await assert.rejects(startOrder(staff, target), { status: 409 });
  count--;
  await startOrder(staff, target);
});

test('staff can save notes on their own open orders and finish their assigned orders', async t => {
  transaction(t);
  t.mock.method(User, 'exists', () => ({ session: async () => ({ _id: staffId }) }));
  t.mock.method(Order, 'findOne', filter => {
    assert.equal(filter.userId.toString(), staffId);
    return { session: async () => ({ orderStatus: 2, userId: staffId, orderDate: new Date('2026-01-01'), orderItems: [] }) };
  });
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.userId.toString(), staffId);
    return update.$set;
  });
  assert.equal((await updateOrderNote(staff, target, 'Note', '')).orderNote, 'Note');
  assert.equal((await updateOrderStatus(staff, target, { orderStatus: 4 })).orderStatus, 4);
});
