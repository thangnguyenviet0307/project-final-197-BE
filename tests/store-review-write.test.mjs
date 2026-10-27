import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import express from 'express';
import app from '../dist/app.js';
import Product from '../dist/models/products.model.js';
import { ProductReview } from '../dist/models/product-reviews.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { Order } from '../dist/models/orders.model.js';
import { storeReviewInputSchema } from '../dist/validations/products.validation.js';
import { createAuthRateLimit } from '../dist/middlewares/auth-rate-limit.middleware.js';

const input = { rating: 5, reviewerName: '  An  ', comment: '  Sản phẩm tốt  ', email: 'an@example.com', phone: '0901234567' };
test('store review validation rejects invalid inputs and forged source/date/identity', () => {
  for (const patch of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { reviewerName: ' ' }, { comment: '' }, { email: 'bad' }, { phone: '<bad>' }, { source: 'admin' }, { date: '2026-01-01T00:00:00Z' }, { product: 'other' }]) {
    assert.equal(storeReviewInputSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.equal(storeReviewInputSchema.parse({ rating: 4, reviewerName: 'A', comment: 'Nice' }).rating, 4);
  assert.equal(ProductReview.schema.path('email').options.select, false);
  assert.equal(ProductReview.schema.path('phone').options.select, false);
});

test('anonymous review saves safely, refreshes metrics and never returns contact data', async t => {
  const id = 'a'.repeat(24);
  const product = { _id: id, category: id, brand: id, is_active: true };
  let active = true;
  let saved;
  for (const model of [Categories, BrandModel]) {
    t.mock.method(model, 'distinct', async () => [new mongoose.Types.ObjectId(id)]);
    t.mock.method(model, 'exists', () => ({ session: async () => ({ _id: id }) }));
  }
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
  t.mock.method(Product, 'findOne', () => ({ select() { return this; }, populate() { return this; }, lean: async () => product, session: async () => active ? product : null }));
  const save = t.mock.method(ProductReview.prototype, 'save', async function () { await this.validate(); saved = this.toObject(); return this; });
  t.mock.method(ProductReview, 'find', () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [saved] }));
  t.mock.method(ProductReview, 'countDocuments', async () => saved ? 1 : 0);
  t.mock.method(ProductReview, 'aggregate', async () => [{ rating: saved.rating, reviewCount: 1, star5: 1 }]);
  t.mock.method(Order, 'aggregate', async () => []);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products/public/test-product`;
  const post = body => fetch(base + '/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post(input);
  assert.equal(response.status, 201);
  assert.equal(saved.source, 'storefront'); assert.equal(saved.reviewerName, 'An'); assert.equal(saved.comment, 'Sản phẩm tốt');
  assert.equal(saved.email, input.email); assert.equal(saved.phone, input.phone);
  const created = await response.json();
  assert.equal(created.data.source, 'storefront');
  for (const key of ['email', 'phone', 'product', '__v']) assert.equal(key in created.data, false);
  const list = await (await fetch(base + '/reviews')).json();
  assert.equal(list.data[0].email, undefined); assert.equal(list.data[0].phone, undefined);
  const metrics = await (await fetch(base + '/metrics')).json();
  assert.deepEqual(metrics.data, { rating: 5, reviewCount: 1, soldCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } });
  assert.equal((await post({ ...input, source: 'admin' })).status, 400);
  active = false;
  assert.equal((await post(input)).status, 404);
  assert.equal(save.mock.callCount(), 1);
});

test('review requests are throttled with a retry delay', async t => {
  const limited = express();
  limited.post('/review', createAuthRateLimit(1, 60000, 'Too many reviews'), (_req, res) => res.sendStatus(201));
  const server = limited.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/review`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 201);
  const denied = await fetch(url, { method: 'POST' });
  assert.equal(denied.status, 429); assert.ok(Number(denied.headers.get('Retry-After')) > 0);
});
