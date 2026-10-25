import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import express from 'express';
import { once } from 'node:events';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { User } from '../dist/models/users.model.js';
import { Order } from '../dist/models/orders.model.js';
import Product from '../dist/models/products.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import productService from '../dist/services/products.service.js';
import { UserService } from '../dist/services/users.service.js';
import { CategoriesService } from '../dist/services/categories.service.js';
import { BrandService } from '../dist/services/brands.service.js';
import { deleteCustomer } from '../dist/services/customers.service.js';
import { assignOrder, createOrder, updateOrderStatus } from '../dist/services/orders.services.js';
import { verifyPassword } from '../dist/utils/password.js';
import { calculateOrderTotal } from '../dist/utils/order-total.js';
import { createAuthRateLimit } from '../dist/middlewares/auth-rate-limit.middleware.js';
import { updateProductSchema } from '../dist/validations/products.validation.js';
import { updateCustomerSchema } from '../dist/validations/customers.validation.js';

const id = () => new mongoose.Types.ObjectId();
const session = {};
const query = (value) => ({ session(actual) { assert.equal(actual, session); return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const actor = { id: String(id()), role: 'admin' };
beforeEach((t) => {
  t.mock.method(mongoose.connection, 'transaction', async (work) => work(session));
  t.mock.method(SystemLock, 'updateOne', async () => ({ acknowledged: true }));
});

test('variant updates preserve omitted stock and metadata; unknown or duplicate IDs fail', async (t) => {
  const product = new Product({ stock: 5, variants: [{ sku: 'OLD-SKU', price: 10, stock: 5,
    images: ['image.jpg'], attributes: { material: 'cotton' }, color: 'black' }] });
  t.mock.method(Product, 'findById', () => query(product));
  t.mock.method(Product, 'exists', async () => null);
  t.mock.method(Order, 'exists', async () => null);
  t.mock.method(product, 'save', async (options) => { assert.equal(options.session, session); return product; });
  const variantId = String(product.variants[0]._id);
  const parsed = updateProductSchema.parse({ variants: [{ _id: variantId, sku: 'NEW-SKU', price: 12 }] });
  await productService.updateProduct(String(product._id), parsed);
  assert.equal(product.stock, 5);
  assert.equal(product.variants[0].stock, 5);
  assert.equal(product.variants[0].color, 'black');
  assert.deepEqual([...product.variants[0].images], ['image.jpg']);
  assert.deepEqual(product.variants[0].attributes, { material: 'cotton' });
  await assert.rejects(productService.updateProduct(String(product._id), { variants: [{ _id: String(id()), sku: 'BAD-SKU', price: 1 }] }), { status: 400 });
  await assert.rejects(productService.updateProduct(String(product._id), { variants: [
    { _id: variantId, sku: 'SKU-A', price: 1 }, { _id: variantId, sku: 'SKU-B', price: 2 },
  ] }), { status: 400 });
  await productService.updateProduct(String(product._id), { variants: [], stock: 8 });
  assert.equal(product.stock, 8);
});

test('model rejects duplicate identities, fractional inventory and mismatched aggregate stock', async () => {
  const variant = { _id: id(), sku: 'SKU-A', price: 1, stock: 1 };
  const base = { product_name: 'Valid product', slug: 'valid-product', brand: id(), category: id(), model_year: 2025 };
  for (const changes of [{ stock: 1.5 }, { stock: 0, variants: [variant] },
    { stock: 2, variants: [variant, { ...variant, sku: 'SKU-B' }] }]) {
    await assert.rejects(new Product({ ...base, ...changes }).validate(), { name: 'ValidationError' });
  }
});

test('last active admin cannot be demoted, disabled or deleted', async (t) => {
  const admin = new User({ role: 'admin', active: true });
  t.mock.method(User, 'findById', () => query(admin));
  t.mock.method(User, 'exists', () => query(null));
  const write = t.mock.method(User, 'findByIdAndUpdate', async () => { throw new Error('Must not write'); });
  await assert.rejects(UserService.updateUser(String(admin._id), { role: 'staff' }), { status: 409 });
  await assert.rejects(UserService.updateUser(String(admin._id), { active: false }), { status: 409 });
  await assert.rejects(UserService.deleteUser(String(admin._id)), { status: 409 });
  assert.equal(write.mock.callCount(), 0);
});

test('another active admin permits demotion and revokes the previous session', async (t) => {
  const admin = new User({ role: 'admin', active: true });
  t.mock.method(User, 'findById', () => query(admin));
  t.mock.method(User, 'exists', () => query({ _id: id() }));
  t.mock.method(User, 'findByIdAndUpdate', async (_id, update, options) => {
    assert.equal(options.session, session);
    assert.equal(update.$set.role, 'staff');
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$inc.tokenVersion, 1);
    return admin;
  });
  await UserService.updateUser(String(admin._id), { role: 'staff' });
});

test('open orders prevent disabling their assignee and any order prevents deleting customer', async (t) => {
  t.mock.method(User, 'findById', () => query(new User({ role: 'staff', active: true })));
  t.mock.method(Order, 'exists', () => query({ _id: id() }));
  await assert.rejects(UserService.updateUser(String(id()), { active: false }), { status: 409 });
  await assert.rejects(deleteCustomer(String(id())), { status: 409 });
});

test('category updates reject self-parent, ancestor cycles and missing parents', async (t) => {
  const category = new Categories({ name: 'Root', slug: 'root' });
  const parent = new Categories({ name: 'Child', slug: 'child', parent: category._id });
  t.mock.method(Categories, 'findOne', (filter) => query(String(filter._id) === String(category._id) ? category :
    String(filter._id) === String(parent._id) ? parent : null));
  await assert.rejects(CategoriesService.updateCategory(String(category._id), { parent: category._id }), { status: 409 });
  await assert.rejects(CategoriesService.updateCategory(String(category._id), { parent: parent._id }), { status: 409 });
  await assert.rejects(CategoriesService.updateCategory(String(category._id), { parent: id() }), { status: 404 });
});

test('catalog references prevent deleting a used brand or category and inactive catalog blocks product creation', async (t) => {
  t.mock.method(Product, 'exists', () => query({ _id: id() }));
  t.mock.method(Categories, 'findById', () => query(new Categories({ name: 'Root', slug: 'root' })));
  await assert.rejects(BrandService.delete(String(id())), { status: 409 });
  await assert.rejects(CategoriesService.deleteCategory(String(id())), { status: 409 });
  t.mock.method(BrandModel, 'exists', () => query(null));
  t.mock.method(Categories, 'exists', () => query({ _id: id() }));
  await assert.rejects(productService.createProduct({ product_name: 'Test product', brand: String(id()), category: String(id()), model_year: 2025 }), { status: 409 });
});

test('order reassignment preserves status, uses the transaction and blocks staff/final orders', async (t) => {
  const order = new Order({ orderStatus: 2 });
  t.mock.method(Order, 'findById', () => query(order));
  t.mock.method(User, 'exists', () => query({ _id: id() }));
  t.mock.method(order, 'save', async (options) => { assert.equal(options.session, session); return order; });
  const assignee = String(id());
  await assignOrder(actor, String(order._id), assignee);
  assert.equal(String(order.userId), assignee);
  assert.equal(order.orderStatus, 2);
  await assert.rejects(assignOrder({ ...actor, role: 'staff' }, String(order._id), assignee), { status: 403 });
  order.orderStatus = 4;
  await assert.rejects(assignOrder(actor, String(order._id), assignee), { status: 409 });
});

test('order date checks reject past requirements and shipping dates on non-completion transitions', async (t) => {
  await assert.rejects(createOrder(actor, { requireDate: new Date(0) }), { status: 400 });
  const order = new Order({ orderStatus: 1, userId: id() });
  t.mock.method(Order, 'findOne', () => query(order));
  t.mock.method(User, 'exists', () => query({ _id: order.userId }));
  await assert.rejects(updateOrderStatus(actor, String(order._id), { orderStatus: 2, shippingDate: new Date() }), { status: 400 });
});

test('money arithmetic avoids binary artifacts, rounds half up per line and rejects overflow', () => {
  assert.equal(calculateOrderTotal([{ quantity: 3, price: 0.1, discount: 0 }]), 0.3);
  assert.equal(calculateOrderTotal([{ quantity: 1, price: 1.005, discount: 0 }]), 1.01);
  assert.equal(calculateOrderTotal([{ quantity: 3, price: 25, discount: 10 }]), 67.5);
  assert.throws(() => calculateOrderTotal([{ quantity: 2, price: Number.MAX_SAFE_INTEGER, discount: 0 }]), { status: 400 });
});

test('bcrypt inputs exceeding 72 bytes cannot authenticate or become a new Argon2 password', async () => {
  const prefix = 'a'.repeat(72);
  const hash = await bcrypt.hash(prefix, 4);
  assert.deepEqual(await verifyPassword(hash, prefix + 'unverified-suffix'), { valid: false, needsUpgrade: false });
  assert.deepEqual(await verifyPassword(hash, prefix), { valid: true, needsUpgrade: true });
  assert.equal(updateCustomerSchema.safeParse({}).success, false);
});

test('authentication rate limit returns 429 and Retry-After before calling the handler again', async (t) => {
  const app = express();
  let called = 0;
  app.post('/login', createAuthRateLimit(2), (_req, res) => { called++; res.sendStatus(401); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/login`;
  for (let i = 0; i < 2; i++) assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const blocked = await fetch(url, { method: 'POST' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(called, 2);
});
