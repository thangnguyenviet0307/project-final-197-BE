import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProductsQuerySchema } from '../dist/validations/products.validation.js';
import { effectivePriceExpression, buildProductQuery, buildProductSort } from '../dist/utils/product-query.js';

test('catalog sorts featured, best seller and discount across the complete filtered result', () => {
  for (const sortBy of ['is_hot', 'is_best_seller', 'discount', 'createdAt', 'price']) {
    const params = getProductsQuerySchema.parse({ sortBy, sortOrder: 'desc', brand: 'a'.repeat(24), minPrice: '2000000', maxPrice: '4000000' });
    assert.deepEqual(buildProductSort(params), { [sortBy]: -1, _id: -1 });
    assert.deepEqual(buildProductQuery(params), { brand: 'a'.repeat(24), $expr: { $and: [{ $gte: [effectivePriceExpression, 2000000] }, { $lte: [effectivePriceExpression, 4000000] }] } });
  }
  assert.deepEqual(buildProductSort(getProductsQuerySchema.parse({ sortBy: 'price', sortOrder: 'asc' })), { price: 1, _id: 1 });
  assert.equal(getProductsQuerySchema.safeParse({ sortBy: '$where' }).success, false);
  assert.equal(getProductsQuerySchema.safeParse({ sortBy: 'count_view' }).success, false);
});

test('multiple catalog choices use OR within groups and AND with price', () => {
  const brand = ['a'.repeat(24), 'b'.repeat(24)];
  const category = ['c'.repeat(24), 'd'.repeat(24)];
  const params = getProductsQuerySchema.parse({ brand: brand.join(','), category: category.join(','), maxPrice: '2000000' });
  assert.deepEqual(buildProductQuery(params), { brand: { $in: brand }, category: { $in: category }, $expr: { $and: [{ $lte: [effectivePriceExpression, 2000000] }] } });
  for (const value of ['', brand[0] + ',', brand[0] + ',$ne', 'invalid']) {
    assert.equal(getProductsQuerySchema.safeParse({ brand: value }).success, false);
    assert.equal(getProductsQuerySchema.safeParse({ category: value }).success, false);
  }
});
