import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../dist/models/products.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { buildProductSearchQuery, discountedPricePageIds, effectivePriceExpression } from '../dist/utils/product-query.js';
test('search combines product, brand and category names without overriding explicit filters or SKU', async t => {
  t.mock.method(BrandModel, 'distinct', async (_field, query) => { assert.equal(query.name.$regex, 'A\\.\\*'); return ['b'.repeat(24)]; });
  t.mock.method(Categories, 'distinct', async () => ['c'.repeat(24)]);
  const query = await buildProductSearchQuery({ search: 'A.*', brand: 'a'.repeat(24), sku: 'SKU' });
  assert.equal(query.$and[0].brand, 'a'.repeat(24));
  assert.equal(query.$and[0].product_name, undefined);
  assert.equal(query.$and[0].$or.length, 2);
  assert.deepEqual(query.$and[1].$or.slice(1), [{ brand: { $in: ['b'.repeat(24)] } }, { category: { $in: ['c'.repeat(24)] } }]);
});
test('price ranking computes discounted variant price before stable sorting and pagination and casts reference IDs', async t => {
  t.mock.method(Product, 'aggregate', async pipeline => {
    assert.equal(String(pipeline[0].$match.brand), 'a'.repeat(24));
    assert.equal(typeof pipeline[0].$match.brand.toHexString, 'function');
    assert.deepEqual(pipeline[1], { $set: { sellingPrice: effectivePriceExpression } });
    assert.deepEqual(pipeline.slice(2, 5), [{ $sort: { sellingPrice: 1, _id: 1 } }, { $skip: 8 }, { $limit: 8 }]);
    return [{ _id: 'selected' }];
  });
  assert.deepEqual(await discountedPricePageIds({ brand: 'a'.repeat(24) }, { sortOrder: 'asc' }, 2, 8), ['selected']);
});
