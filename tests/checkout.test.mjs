import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { checkoutSchema } from '../dist/validations/checkout.validation.js';
import { checkout } from '../dist/services/checkout.service.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { Customer } from '../dist/models/customers.model.js';
import Product from '../dist/models/products.model.js';
import { Order } from '../dist/models/orders.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import app from '../dist/app.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
const customerId = String(new mongoose.Types.ObjectId());
const productId = String(new mongoose.Types.ObjectId());
const input = () => checkoutSchema.parse({ requestId: randomUUID(), recipientName: 'Người nhận', phone: '0901234567', provinceCode: 1, districtCode: 2, wardCode: 3, street: '12 Đường A', note: 'Giao buổi sáng', paymentMethod: 'cod', items: [{ productId, quantity: 2, expectedUnitPrice: 90 }] });
const locations = [{ code: 1, name: 'Tỉnh A', districts: [{ code: 2, name: 'Huyện B', wards: [{ code: 3, name: 'Xã C' }] }] }];
function harness(t) {
  const state = { saved: [], aborted: 0 };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => locations }));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => { try { return await callback({}); } catch (error) { state.aborted++; throw error; } });
  const customer = { _id: customerId, tokenVersion: 0, firstName: 'Tên', lastName: 'Họ', email: 'customer@example.com', phone: '0999999999' };
  t.mock.method(Customer, 'findOne', () => ({ select() { return this; }, session: async () => customer }));
  for (const model of [BrandModel, Categories]) t.mock.method(model, 'exists', () => ({ session() { return this; }, then(resolve) { return Promise.resolve({}).then(resolve); } }));
  const product = new Product({ _id: productId, product_name: 'Sản phẩm', sku: 'TEST', price: 100, discount: 10, stock: 5, is_active: true });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  t.mock.method(product, 'save', async () => product);
  t.mock.method(Order, 'findOne', () => ({ select() { return this; }, session: async () => state.saved[0] ?? null }));
  t.mock.method(Order.prototype, 'save', async function () { await this.validate(); state.saved.push(this); return this; });
  return { state, product, customer };
}
test('checkout rejects caller identity, totals, invalid phone, quantities, payment and duplicate lines', () => {
  const valid = input();
  for (const change of [{ customerId }, { userId: customerId }, { totalAmount: 1 }, { phone: '123' }, { paymentMethod: 'card' }, { wardCode: 0 }, { items: [] }, { items: [valid.items[0], valid.items[0]] }, { items: [{ ...valid.items[0], quantity: 0 }] }, { items: [{ ...valid.items[0], price: 1 }] }]) assert.equal(checkoutSchema.safeParse({ ...valid, ...change }).success, false);
});
test('locality requests are coalesced/cached and upstream failures fail closed', async t => {
  const fresh = await import('../dist/services/checkout-locations.service.js?cache-test');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => locations }));
  const [a, b] = await Promise.all([fresh.getCheckoutLocations(), fresh.getCheckoutLocations()]);
  assert.deepEqual(a, b);
  assert.equal(fetchMock.mock.callCount(), 1);
  await assert.rejects(fresh.resolveCheckoutAddress(1, 99, 3), { status: 400 });
  assert.equal(fetchMock.mock.callCount(), 1);
  fetchMock.mock.mockImplementation(async () => { throw new Error('Offline'); });
  const offline = await import('../dist/services/checkout-locations.service.js?offline-test');
  await assert.rejects(offline.getCheckoutLocations(), { status: 503 });
});
test('checkout creates an unassigned pending COD order, uses server price and snapshots recipient without editing profile', async t => {
  const { state, product, customer } = harness(t);
  const result = await checkout(customerId, 0, input());
  assert.equal(result.totalAmount, 180);
  assert.equal(result.orderStatus, 1);
  assert.match(result.orderCode, /^ORD-/);
  assert.equal(product.stock, 3);
  assert.equal(state.saved[0].userId, undefined);
  assert.equal(String(state.saved[0].customerId), customerId);
  assert.equal(state.saved[0].recipientName, 'Người nhận');
  assert.equal(state.saved[0].recipientPhone, '0901234567');
  assert.equal(customer.phone, '0999999999');
  assert.equal(state.saved[0].city, 'Xã C, Huyện B');
  assert.equal(state.saved[0].orderItems[0].price, 100);
});
test('replaying the same request returns the original order and reserves stock once; changed payload conflicts', async t => {
  const { state, product } = harness(t);
  const request = input();
  const first = await checkout(customerId, 0, request);
  const second = await checkout(customerId, 0, request);
  assert.deepEqual(second, first);
  assert.equal(state.saved.length, 1);
  assert.equal(product.stock, 3);
  await assert.rejects(checkout(customerId, 0, { ...request, street: 'Other' }), { status: 409 });
});
test('price changes and stock conflicts abort without creating an order', async t => {
  const { state, product } = harness(t);
  await assert.rejects(checkout(customerId, 0, { ...input(), items: [{ productId, quantity: 2, expectedUnitPrice: 1 }] }), { status: 409 });
  product.stock = 1;
  await assert.rejects(checkout(customerId, 0, input()), { status: 409 });
  assert.equal(state.saved.length, 0);
  assert.equal(product.stock, 1);
  assert.equal(state.aborted, 2);
});
test('mismatched address, revoked session, and stopped products cannot create orders', async t => {
  const { state, product } = harness(t);
  await assert.rejects(checkout(customerId, 0, { ...input(), districtCode: 9 }), { status: 400 });
  await assert.rejects(checkout(customerId, 1, input()), { status: 401 });
  product.on_sale = false;
  await assert.rejects(checkout(customerId, 0, input()), { status: 409 });
  assert.equal(state.saved.length, 0);
  assert.equal(product.stock, 5);
});
test('customer checkout endpoint rejects anonymous/admin identities and validates authenticated requests', async t => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/customer-auth/orders`;
  const headers = { 'Content-Type': 'application/json', 'X-Login-Area': 'storefront' };
  const send = (token, body = input()) => fetch(url, { method: 'POST', headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send()).status, 401);
  assert.equal((await send(generateAccessToken({ id: customerId, tokenVersion: 0 }))).status, 403);
  t.mock.method(Customer, 'findById', () => ({ select: async () => ({ _id: customerId, isActive: true, accountEnabled: true, tokenVersion: 0 }) }));
  assert.equal((await send(generateAccessToken({ id: customerId, tokenVersion: 0, accountType: 'customer' }), { ...input(), customerId })).status, 400);
});
