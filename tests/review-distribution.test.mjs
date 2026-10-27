import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductReview } from '../dist/models/product-reviews.model.js';
import { Order } from '../dist/models/orders.model.js';
import { getProductMetrics } from '../dist/services/product-reviews.service.js';

test('public metrics aggregate all five star counts over all reviews, independently of pagination', async t => {
  t.mock.method(ProductReview, 'aggregate', async pipeline => {
    for (const star of [1, 2, 3, 4, 5]) assert.deepEqual(pipeline[1].$group[`star${star}`], { $sum: { $cond: [{ $eq: ['$rating', star] }, 1, 0] } });
    return [{ rating: 3.333333, reviewCount: 6, star1: 1, star2: 1, star3: 1, star4: 1, star5: 2 }];
  });
  t.mock.method(Order, 'aggregate', async () => []);
  assert.deepEqual(await getProductMetrics('a'.repeat(24), true), { rating: 3.3, reviewCount: 6, soldCount: 0, ratingDistribution: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2 } });
});
test('public metrics have a zero-filled distribution when no reviews exist', async t => {
  t.mock.method(ProductReview, 'aggregate', async () => []);
  t.mock.method(Order, 'aggregate', async () => []);
  assert.deepEqual(await getProductMetrics('a'.repeat(24), true), { rating: 0, reviewCount: 0, soldCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
});
