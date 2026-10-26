import assert from 'node:assert/strict';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import Product from '../dist/models/products.model.js';
import { getStorefrontProduct } from '../dist/services/storefront.service.js';
import app from '../dist/app.js';

let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const sample = () => ({ _id: 'a'.repeat(24), product_name: 'API Headphones', slug: 'api-headphones', description: '<p>Real description</p>', model_year: 2026,
  category: { _id: 'b'.repeat(24), name: 'Audio', slug: 'audio' }, brand: { _id: 'c'.repeat(24), name: 'Brand', slug: 'brand' },
  price: 100, discount: 10, stock: 100, thumbnail: null, images: [{ public_id: 'secret/storage/id', secure_url: 'https://images.test/a.jpg' }],
  __v: 19, createdAt: new Date(), variants: [{ _id: 'd'.repeat(24), sku: 'BLACK', variant_name: null, color: 'Black', size: 'L', price: 100, compare_at_price: 120, stock: 100, image: null, images: [], attributes: { private: 'internal' } }] });
function mockProduct(t, value) {
  const chain = { select(fields) { assert.ok(fields.includes('slug')); return this; }, populate(options) { assert.deepEqual(options.match, { isActive: true, isDeleted: { $ne: true } }); return this; }, lean: async () => value };
  return t.mock.method(Product, 'findOne', filter => { assert.deepEqual(filter, { slug: 'api-headphones', is_active: true }); return chain; });
}
test('public storefront DTO exposes availability and discounted prices but no inventory or storage internals', async t => {
  mockProduct(t, sample());
  const dto = await getStorefrontProduct('api-headphones');
  assert.equal(dto.price, 90); assert.equal(dto.available, true); assert.equal(dto.variants[0].price, 90);
  assert.equal(dto.variants[0].name, 'Black / L');
  assert.equal(dto.stock, undefined); assert.equal(dto.__v, undefined);
  assert.equal(dto.variants[0].stock, undefined); assert.equal(dto.variants[0].attributes, undefined);
  assert.deepEqual(dto.images, ['https://images.test/a.jpg']);
  assert.equal(JSON.stringify(dto).includes('secret/storage/id'), false);
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
