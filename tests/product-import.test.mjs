import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import Product from '../dist/models/products.model.js';
import { ProductReview } from '../dist/models/product-reviews.model.js';
import { Order } from '../dist/models/orders.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { createProductSchema, updateProductSchema, importDummyProductSchema, reviewInputSchema } from '../dist/validations/products.validation.js';
import { mapDummyProduct, importDummyProduct } from '../dist/services/product-import.service.js';
import { getProductMetrics } from '../dist/services/product-reviews.service.js';
import { buildProductQuery } from '../dist/utils/product-query.js';

const id = 'a'.repeat(24);
const sample = () => ({
  sourceCurrency: 'USD', exchangeRate: 25000, weightUnit: 'kg', dimensionUnit: 'cm',
  product: { id: 1, title: 'Lash Princess', category: 'beauty', brand: 'Essence', price: 9.99, stock: 5,
    sku: 'RCH45Q1A', discountPercentage: 7.17, minimumOrderQuantity: 24,
    rating: 4.94, thumbnail: 'https://images.example/a.png', images: ['https://images.example/a.png'],
    reviews: [{ rating: 2, comment: 'Example', reviewerName: 'John', reviewerEmail: 'private@example.com' }],
    meta: { barcode: '0012345', createdAt: '2024-05-23T08:56:21.618Z' } },
});

test('import mapping converts USD explicitly, preserves provenance and leaves images unpublished', () => {
  const input = importDummyProductSchema.parse(sample());
  const mapped = mapDummyProduct(input, id, id);
  assert.equal(mapped.product_name, 'Lash Princess');
  assert.equal(mapped.price, 249750);
  assert.equal(mapped.discount, 7.17);
  assert.equal(mapped.currency, 'VND');
  assert.equal(mapped.barcode, '0012345');
  assert.equal(mapped.external_id, '1');
  assert.equal(mapped.model_year, undefined);
  assert.equal(mapped.is_active, false);
  assert.equal(mapped.thumbnail, undefined);
  assert.equal(mapped.images, undefined);
  assert.deepEqual(mapped.sourceImages, ['https://images.example/a.png']);
  assert.equal(input.product.reviews[0].reviewerEmail, undefined);
  assert.equal(input.product.rating, undefined);
});

test('import rejects missing rates/units, unsupported discounts and invalid image URLs', () => {
  for (const field of ['exchangeRate', 'sourceCurrency', 'weightUnit', 'dimensionUnit']) {
    const input = sample(); delete input[field];
    assert.equal(importDummyProductSchema.safeParse(input).success, false, field);
  }
  for (const patch of [{ discountPercentage: 71 }, { thumbnail: '...' }, { stock: 1.5 }, { minimumOrderQuantity: 0 }, { reviews: [{ rating: 6 }] }]) {
    const input = sample(); Object.assign(input.product, patch);
    assert.equal(importDummyProductSchema.safeParse(input).success, false);
  }
  const input = importDummyProductSchema.parse(sample()); input.exchangeRate = Number.MAX_VALUE;
  assert.throws(() => mapDummyProduct(input, id, id), { status: 400 });
  for (const exchangeRate of [Infinity, -Infinity, NaN]) {
    assert.equal(importDummyProductSchema.safeParse({ ...sample(), exchangeRate }).success, false);
  }
});

test('generic product supports optional model year and validates new metadata', async () => {
  const payload = createProductSchema.parse({ product_name: 'Mascara', category: id, brand: id, sku: 'abc-123', barcode: '000123' });
  assert.equal(payload.sku, 'ABC-123');
  const product = new Product({ ...payload, slug: 'mascara' });
  await product.validate();
  assert.equal(product.model_year, null);
  assert.equal(product.currency, 'VND');
  assert.equal(product.minimumOrderQuantity, 1);
  for (const patch of [{ currency: 'USD' }, { weight: -1 }, { weight: Infinity }, { weight: NaN }, { price: -Infinity }, { dimensions: { width: 1 } }, { dimensions: { width: 1, height: Infinity, depth: 1 } }, { tags: [''] }, { minimumOrderQuantity: 1.2 }, { minimumOrderQuantity: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(createProductSchema.safeParse({ ...payload, ...patch }).success, false);
  }
  assert.equal(updateProductSchema.safeParse({ model_year: null }).success, true);
  assert.equal(reviewInputSchema.safeParse({ rating: 2.5, comment: 'Test', reviewerName: 'Name' }).success, false);
  assert.deepEqual(buildProductQuery({ sku: 'abc-123' }).$or, [{ sku: 'ABC-123' }, { 'variants.sku': 'ABC-123' }]);
});

function importHarness(t, existing = false) {
  const session = {};
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback(session));
  t.mock.method(Product, 'exists', filter => {
    const result = filter.source && existing ? { _id: id } : null;
    return { session: async () => result, then(resolve) { return Promise.resolve(result).then(resolve); } };
  });
  for (const model of [BrandModel, Categories]) {
    t.mock.method(model, 'findOne', filter => {
      assert.equal(filter.isActive, true); assert.deepEqual(filter.isDeleted, { $ne: true });
      return { session: async () => ({ _id: new mongoose.Types.ObjectId(id) }) };
    });
    t.mock.method(model, 'exists', () => ({ session: async () => ({ _id: id }) }));
  }
  t.mock.method(Product.prototype, 'save', async function (options) {
    assert.equal(options.session, session); await this.validate(); return this;
  });
  return session;
}

test('import persists product and source reviews in the same transaction', async t => {
  const session = importHarness(t);
  const insert = t.mock.method(ProductReview, 'insertMany', async (reviews, options) => {
    assert.equal(options.session, session);
    assert.equal(reviews[0].source, 'dummyjson');
    assert.equal(reviews[0].reviewerEmail, undefined);
    return [];
  });
  const product = await importDummyProduct(importDummyProductSchema.parse(sample()));
  assert.equal(product.source, 'dummyjson');
  assert.equal(product.external_id, '1');
  assert.equal(product.price, 249750);
  assert.equal(insert.mock.callCount(), 1);
});

test('repeat imports return a conflict without overwriting inventory or duplicating reviews', async t => {
  importHarness(t, true);
  const insert = t.mock.method(ProductReview, 'insertMany', async () => { throw new Error('Must not insert'); });
  await assert.rejects(importDummyProduct(importDummyProductSchema.parse(sample())), { status: 409 });
  assert.equal(insert.mock.callCount(), 0);
});

test('import rejects missing or inactive catalog references', async t => {
  importHarness(t);
  t.mock.method(Categories, 'findOne', () => ({ session: async () => null }));
  await assert.rejects(importDummyProduct(importDummyProductSchema.parse(sample())), { status: 400 });
});

test('metrics aggregate stars from reviews and quantities only from completed orders', async t => {
  t.mock.method(ProductReview, 'aggregate', async pipeline => {
    assert.equal(String(pipeline[0].$match.product), id);
    assert.equal(pipeline[1].$group.rating.$avg, '$rating');
    return [{ rating: 4.666666, reviewCount: 37 }];
  });
  t.mock.method(Order, 'aggregate', async pipeline => {
    assert.equal(pipeline[0].$match.orderStatus, 4);
    assert.equal(String(pipeline[2].$match['orderItems.productId']), id);
    assert.equal(pipeline[3].$group.soldCount.$sum, '$orderItems.quantity');
    return [{ soldCount: 166 }];
  });
  assert.deepEqual(await getProductMetrics(id), { rating: 4.7, reviewCount: 37, soldCount: 166 });
});

test('products without reviews or completed sales return zeros', async t => {
  t.mock.method(ProductReview, 'aggregate', async () => []);
  t.mock.method(Order, 'aggregate', async () => []);
  assert.deepEqual(await getProductMetrics(id), { rating: 0, reviewCount: 0, soldCount: 0 });
});
