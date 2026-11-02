import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, beforeEach, test } from 'node:test';
import Product from '../dist/models/products.model.js';
import { getStorefrontProduct } from '../dist/services/storefront.service.js';
import app from '../dist/app.js';

import { ProductReview } from '../dist/models/product-reviews.model.js';
import { Order } from '../dist/models/orders.model.js';
beforeEach(t => {
  t.mock.method(ProductReview, 'aggregate', async () => []);
  t.mock.method(Order, 'aggregate', async () => []);
});
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const sample = () => ({ _id: 'a'.repeat(24), product_name: 'API Headphones', slug: 'api-headphones', description: '<p>Real description</p>', model_year: 2026,
  category: { _id: 'b'.repeat(24), name: 'Audio', slug: 'audio' }, brand: { _id: 'c'.repeat(24), name: 'Brand', slug: 'brand' },
  price: 100, discount: 10, stock: 100, thumbnail: null, images: [{ public_id: 'secret/storage/id', secure_url: 'https://images.test/a.jpg' }],
  __v: 19, createdAt: new Date(), variants: [{ _id: 'd'.repeat(24), sku: 'BLACK', variant_name: null, color: 'Black', size: 'L', price: 100, compare_at_price: 120, stock: 100, image: null, images: [], attributes: { private: 'internal' } }] });
function mockProduct(t, value) {
  const chain = { select(fields) { assert.ok(fields.includes('slug')); return this; }, populate(options) { assert.deepEqual(options.match, { isActive: true, isDeleted: { $ne: true } }); return this; }, lean: async () => value };
  return t.mock.method(Product, 'findOne', filter => { assert.deepEqual(filter, { slug: 'api-headphones', is_active: true, on_sale: { $ne: false } }); return chain; });
}
test('public storefront DTO exposes availability and discounted prices but no inventory or storage internals', async t => {
  mockProduct(t, sample());
  const dto = await getStorefrontProduct('api-headphones');
  assert.equal(dto.price, 90); assert.equal(dto.available, true); assert.equal(dto.variants[0].price, 90);
  assert.equal(dto.compareAtPrice, 120);
  assert.equal(dto.variants[0].name, 'Black / L');
  assert.equal(dto.stock, undefined); assert.equal(dto.__v, undefined);
  assert.equal(dto.currency, 'VND');
  assert.equal(dto.rating, 0); assert.equal(dto.reviewCount, 0); assert.equal(dto.soldCount, 0);
  assert.equal(dto.variants[0].stock, undefined); assert.equal(dto.variants[0].attributes, undefined);
  assert.deepEqual(dto.images, ['https://images.test/a.jpg']);
  assert.equal(JSON.stringify(dto).includes('secret/storage/id'), false);
});

test('product price and compareAtPrice come from the same cheapest variant, with a correct non-variant fallback', async t => {
  const row = sample();
  row.variants.push({ ...row.variants[0], _id: 'e'.repeat(24), price: 50, compare_at_price: null });
  mockProduct(t, row);
  let dto = await getStorefrontProduct('api-headphones');
  assert.equal(dto.price, 45); assert.equal(dto.compareAtPrice, 50);
  row.variants = [];
  dto = await getStorefrontProduct('api-headphones');
  assert.equal(dto.price, 90); assert.equal(dto.compareAtPrice, 100);
});
test('public storefront hides products whose category or brand is inactive/deleted', async t => {
  for (const field of ['category', 'brand']) {
    const row = sample(); row[field] = null;
    const stub = mockProduct(t, row); assert.equal(await getStorefrontProduct('api-headphones'), null); stub.mock.restore();
  }
});
test('public storefront reads require no staff authorization', async t => {
  mockProduct(t, sample());
  const response = await fetch(`${base}/api/v1/storefront/products/api-headphones`);
  assert.equal(response.status, 200);
  const json = await response.json(); assert.equal(json.success, true); assert.equal(json.data.slug, 'api-headphones');
});
test('missing and unpublished products return a normal 404 response', async t => {
  mockProduct(t, null);
  const response = await fetch(`${base}/api/v1/storefront/products/api-headphones`);
  assert.equal(response.status, 404); const json = await response.json(); assert.equal(json.success, false);
});
test('public storefront validates slug bounds before querying MongoDB', async t => {
  t.mock.method(Product, 'findOne', () => { throw new Error('Must not query invalid slug'); });
  const response = await fetch(`${base}/api/v1/storefront/products/ab`);
  assert.equal(response.status, 400);
});
test('internal product endpoints remain protected', async () => {
  const response = await fetch(`${base}/api/v1/products/${'a'.repeat(24)}`);
  assert.equal(response.status, 401);
});

test('product import and review writes require authentication', async () => {
  for (const path of ['import/dummyjson', `${'a'.repeat(24)}/reviews`]) {
    const response = await fetch(`${base}/api/v1/products/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
  }
});

test('public reviews expose source attribution and omit private and internal fields', async t => {
  mockProduct(t, sample());
  const review = { rating: 5, comment: 'Good', reviewerName: 'Jane', date: new Date(), source: 'dummyjson', reviewerEmail: 'private@example.com', _id: 'internal-id', product: 'internal-product' };
  const chain = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [review] };
  t.mock.method(ProductReview, 'find', () => chain);
  t.mock.method(ProductReview, 'countDocuments', async () => 1);
  const response = await fetch(`${base}/api/v1/storefront/products/api-headphones/reviews?page=1&limit=10`);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.data[0].source, 'dummyjson');
  assert.equal(json.data[0].rating, 5);
  assert.equal(json.data[0].reviewerEmail, undefined);
  assert.equal(json.data[0]._id, undefined);
  assert.equal(json.data[0].product, undefined);
  assert.equal(json.pagination.total, 1);
});
