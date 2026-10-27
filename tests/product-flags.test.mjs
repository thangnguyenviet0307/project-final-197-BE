import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import app from '../dist/app.js';
import Product from '../dist/models/products.model.js';
import { User } from '../dist/models/users.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { updateProductFlagsSchema, getProductsQuerySchema } from '../dist/validations/products.validation.js';
import { buildProductQuery } from '../dist/utils/product-query.js';

const id = 'a'.repeat(24);
process.env.JWT_SECRET = randomBytes(32).toString('hex');
test('quick flags are strict booleans with a required version and at least one field', () => {
  for (const input of [{}, { expectedVersion: 0 }, { is_hot: true }, { expectedVersion: 0, is_hot: 'false' }, { expectedVersion: 0, price: 5 }, { expectedVersion: 0, stock: 5 }, { expectedVersion: -1, is_home: true }]) {
    assert.equal(updateProductFlagsSchema.safeParse(input).success, false);
  }
  assert.deepEqual(updateProductFlagsSchema.parse({ expectedVersion: 0, is_hot: false }), { expectedVersion: 0, is_hot: false });
  const filters = getProductsQuerySchema.parse({ is_home: 'true', is_hot: 'false', on_sale: 'true' });
  assert.deepEqual(buildProductQuery(filters), { is_home: true, is_hot: { $ne: true }, on_sale: { $ne: false } });
  assert.equal(getProductsQuerySchema.safeParse({ is_home: 'anything' }).success, false);
  assert.equal(updateProductFlagsSchema.safeParse({ expectedVersion: 0, is_best: true }).success, false);
  assert.equal(Product.schema.path("is_best"), undefined);
  const product = new Product();
  assert.equal(product.on_sale, true);
  for (const field of ['is_best_seller', 'is_new', 'is_hot', 'is_home']) assert.equal(product[field], false);
});

test('quick flags enforce admin access, reject metadata, retain stock and return 409 for stale versions', async t => {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/products/${id}/flags`;
  let role = 'staff';
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: id, email: 'test@example.com', firstName: 'Test', lastName: 'User', role, active: true, tokenVersion: 0 }) }));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
  const product = new Product({ _id: id, product_name: 'Test case', slug: 'test-case', stock: 7, price: 100, __v: 3 });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  const save = t.mock.method(product, 'save', async () => { product.__v += 1; return product; });
  const request = (input, token) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const token = generateAccessToken({ id });
  assert.equal((await request({ expectedVersion: 3, is_home: true })).status, 401);
  assert.equal((await request({ expectedVersion: 3, is_home: true }, generateAccessToken({ id, accountType: 'customer' }))).status, 403);
  assert.equal((await request({ expectedVersion: 3, is_home: true }, token)).status, 403);
  role = 'admin';
  assert.equal((await request({ expectedVersion: 3, price: 1 }, token)).status, 400);
  const result = await request({ expectedVersion: 3, is_home: true, is_best_seller: true }, token);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).data.is_home, true);
  assert.equal(product.is_best_seller, true);
  assert.equal(product.stock, 7); assert.equal(product.price, 100);
  assert.equal((await request({ expectedVersion: 3, is_home: false }, token)).status, 409);
  assert.equal(product.is_home, true); assert.equal(save.mock.callCount(), 1);
});
