import assert from 'node:assert/strict';
import { test } from 'node:test';
import Product from '../dist/models/products.model.js';
import { getStorefrontRecommendations } from '../dist/services/storefront.service.js';

test('recommendations are bounded, exclude the current product, and hide inactive relations', async t => {
  const list = { select(value) { assert.equal(value, 'slug'); return this; }, sort() { return this; }, limit(value) { assert.equal(value, 12); return this; }, lean: async () => [{ slug: 'hidden-product' }] };
  t.mock.method(Product, 'find', filter => { assert.deepEqual(filter, { is_active: true, slug: { $ne: 'current-product' } }); return list; });
  const detail = { select() { return this; }, populate() { return this; }, lean: async () => null };
  t.mock.method(Product, 'findOne', filter => { assert.deepEqual(filter, { slug: 'hidden-product', is_active: true }); return detail; });
  assert.deepEqual(await getStorefrontRecommendations('current-product'), []);
});
