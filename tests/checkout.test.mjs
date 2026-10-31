import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createCheckout } from '../dist/services/checkout.service.js';
import { getCheckoutLocations, resolveCheckoutAddress } from '../dist/services/checkout-locations.service.js';
import { checkoutSchema } from '../dist/validations/checkout.validation.js';
import { CheckoutRequest } from '../dist/models/checkout-requests.model.js';
import { Order } from '../dist/models/orders.model.js';
import { Customer } from '../dist/models/customers.model.js';
import Product from '../dist/models/products.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';

const id = () => String(new mongoose.Types.ObjectId());
const places = [{ code: 1, name: 'Province', districts: [{ code: 2, name: 'District', wards: [{ code: 3, name: 'Ward' }] }] }];
const input = productId => ({ requestId: randomUUID(), recipientName: 'Recipient', phone: '0901234567', provinceCode: 1, districtCode: 2, wardCode: 3, street: 'Street', note: '', paymentMethod: 'cod', items: [{ productId, quantity: 2, expectedUnitPrice: 90 }] });
function query(value) { return { select() { return this; }, session() { return Promise.resolve(value); }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; }
beforeEach(t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(places), { status: 200 }));
});

test('checkout validation rejects forged identity, unsupported payment, invalid amounts and oversized orders', () => {
  const valid = input(id());
  for (const change of [{ customerId: id() }, { userId: id() }, { paymentMethod: 'card' }, { requestId: 'invalid' }, { provinceCode: -1 }, { items: [] }, { items: [{ ...valid.items[0], quantity: 1.5 }] }, { items: [{ ...valid.items[0], expectedUnitPrice: -1 }] }, { items: [{ ...valid.items[0], price: 1 }] }, { items: Array(101).fill(valid.items[0]) }]) {
    assert.equal(checkoutSchema.safeParse({ ...valid, ...change }).success, false);
  }
});

test('locations coalesce/cache validated v1 data and reject mismatched locality hierarchy', async t => {
  const [first, second] = await Promise.all([getCheckoutLocations(), getCheckoutLocations()]);
  assert.deepEqual(first, places); assert.deepEqual(second, places);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
  assert.equal(globalThis.fetch.mock.calls[0].arguments[0], 'https://provinces.open-api.vn/api/v1/?depth=3');
  await assert.rejects(resolveCheckoutAddress({ provinceCode: 1, districtCode: 99, wardCode: 3 }), { status: 400 });
});

function fixture(t) {
  const customerId = id(), session = {};
  const receipts = new Map();
  const product = new Product({ product_name: 'Snapshot', price: 100, discount: 10, stock: 10 });
  t.mock.method(Order, 'findOne', () => query(null));
  const orderSaves = t.mock.method(Order.prototype, 'save', async function () { return this; });
  t.mock.method(mongoose.connection, 'transaction', callback => callback(session));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(CheckoutRequest, 'findOne', scope => query(receipts.get(`${scope.customerId}:${scope.requestId}`) ?? null));
  t.mock.method(CheckoutRequest.prototype, 'save', async function () { receipts.set(`${this.customerId}:${this.requestId}`, this); return this; });
  t.mock.method(Customer, 'findOne', () => query({ firstName: 'Account', lastName: 'Owner', phone: '0123456789', email: 'account@example.com' }));
  t.mock.method(Product, 'findById', () => query(product));
  t.mock.method(product, 'save', async () => product);
  for (const model of [BrandModel, Categories]) t.mock.method(model, 'exists', () => query({ _id: id() }));
  return { customerId, product, receipts, orderSaves };
}

test('COD checkout uses server prices, reserves stock and snapshots delivery separately from account', async t => {
  const { customerId, product, orderSaves } = fixture(t);
  const result = await createCheckout(customerId, input(String(product._id)));
  assert.equal(result.totalAmount, 180); assert.equal(result.orderStatus, 1); assert.equal(product.stock, 8);
  const order = orderSaves.mock.calls[0].this;
  assert.equal(order.userId, undefined); assert.equal(order.recipientName, 'Recipient');
  assert.equal(order.recipientPhone, '0901234567'); assert.equal(order.customerSnapshot.phone, '0123456789');
  assert.equal(order.deliveryAddress.ward, 'Ward'); assert.equal(order.orderItems[0].price, 100);
});

test('replay returns original confirmation even after order deletion without reserving stock again', async t => {
  const { customerId, product, orderSaves } = fixture(t);
  const request = input(String(product._id));
  const first = await createCheckout(customerId, request);
  const second = await createCheckout(customerId, request);
  assert.equal(String(first._id), String(second._id)); assert.equal(second.totalAmount, 180);
  assert.equal(orderSaves.mock.callCount(), 1); assert.equal(product.stock, 8);
  await assert.rejects(createCheckout(customerId, { ...request, street: 'Different street' }), { status: 409 });
  assert.equal(product.stock, 8);
});

test('same request ID belongs to one customer only', async t => {
  const { customerId, product, orderSaves } = fixture(t);
  const request = input(String(product._id));
  await createCheckout(customerId, request); await createCheckout(id(), request);
  assert.equal(orderSaves.mock.callCount(), 2); assert.equal(product.stock, 6);
});

test('stale price, unavailable catalog, missing variants and stock cannot create orders', async t => {
  const { customerId, product, orderSaves } = fixture(t);
  const request = input(String(product._id));
  await assert.rejects(createCheckout(customerId, { ...request, items: [{ ...request.items[0], expectedUnitPrice: 1 }] }), { status: 409 });
  product.on_sale = false;
  await assert.rejects(createCheckout(customerId, request), { status: 409 });
  product.on_sale = true; product.stock = 1;
  await assert.rejects(createCheckout(customerId, request), { status: 409 });
  product.stock = 10;
  await assert.rejects(createCheckout(customerId, { ...request, items: [{ ...request.items[0], variantId: id() }] }), { status: 404 });
  assert.equal(orderSaves.mock.callCount(), 0);
});

test('disabled customer cannot reserve stock or place orders', async t => {
  const { customerId, product, orderSaves } = fixture(t);
  t.mock.method(Customer, 'findOne', () => query(null));
  await assert.rejects(createCheckout(customerId, input(String(product._id))), { status: 403 });
  assert.equal(product.stock, 10); assert.equal(orderSaves.mock.callCount(), 0);
});

test('expired locality cache fails closed on provider outage or malformed responses', async t => {
  const current = Date.now();
  t.mock.method(Date, 'now', () => current + 25 * 60 * 60 * 1000);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  await assert.rejects(getCheckoutLocations(), { status: 503 });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Network unavailable'); });
  await assert.rejects(getCheckoutLocations(), { status: 503 });
});
