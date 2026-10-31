import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import app from '../dist/app.js';
import Product from '../dist/models/products.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { getProductsQuerySchema, updateProductFlagsSchema } from '../dist/validations/products.validation.js';
import { buildProductQuery, buildProductSort } from '../dist/utils/product-query.js';

function references(t) {
  for (const model of [Categories, BrandModel]) t.mock.method(model, 'distinct', async (_field, query) => {
    assert.equal(query.isActive, true); assert.deepEqual(query.isDeleted, { $ne: true }); return ['active-id'];
  });
}

test('Best Seller is a manual flag and count_view is not writable via flags', () => {
  const query = getProductsQuerySchema.parse({ is_best_seller: 'true', sortBy: 'createdAt', sortOrder: 'desc' });
  assert.deepEqual(buildProductQuery(query), { is_best_seller: true });
  assert.deepEqual(buildProductSort(query), { createdAt: -1, _id: -1 });
  assert.equal(getProductsQuerySchema.safeParse({ sortBy: "count_view" }).success, false);
  assert.equal(new Product().count_view, 0);
  assert.equal(new Product().is_best_seller, false);
  assert.equal(updateProductFlagsSchema.safeParse({ expectedVersion: 0, count_view: 100 }).success, false);
});

test('public view endpoint atomically increments once per request without changing inventory or version', async t => {
  references(t);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  let count = 0;
  const write = t.mock.method(Product, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.slug, 'test-product'); assert.equal(filter.is_active, true);
    assert.deepEqual(filter.on_sale, { $ne: false });
    assert.deepEqual(filter.category, { $in: ['active-id'] });
    assert.deepEqual(filter.brand, { $in: ['active-id'] });
    assert.deepEqual(update, { $inc: { count_view: 1 } });
    assert.deepEqual(options, { returnDocument: "after", timestamps: false });
    count++;
    return { select(fields) { assert.equal(fields, 'count_view -_id'); return this; }, lean: async () => ({ count_view: count }) };
  });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/products/public/test-product/views`;
  const post = (body = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const expected of [1, 2]) {
    const response = await post(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).data, { count_view: expected });
  }
  assert.equal((await post({ count_view: 200 })).status, 400);
  assert.equal(write.mock.callCount(), 2);
});

test('missing or unpublished products return 404 without recording a view', async t => {
  references(t);
  t.mock.method(Product, 'findOneAndUpdate', () => ({ select() { return this; }, lean: async () => null }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products/public`;
  assert.equal((await fetch(base + '/hidden-product/views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch(base + '/x/views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
});
