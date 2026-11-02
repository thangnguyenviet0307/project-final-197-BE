import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { ImageCleanupJob } from '../dist/models/image-cleanup-jobs.model.js';
import { v2 as cloudinary } from 'cloudinary';
import Product from '../dist/models/products.model.js';
import productService from '../dist/services/products.service.js';
import { getProductsQuerySchema } from '../dist/validations/products.validation.js';
import { buildProductQuery, buildProductSort, effectivePriceExpression } from '../dist/utils/product-query.js';
import { addProductImage, removeProductImage, validateProductImage } from '../dist/services/product-images.service.js';

beforeEach(t => {
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(ImageCleanupJob, 'bulkWrite', async () => ({}));
});
const id = 'a'.repeat(24);
test('renaming through a partial API update preserves the existing slug without a client workaround', async t => {
  const product = new Product({ product_name: 'Old name', slug: 'shared-bookmark', price: 100, stock: 2 });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  t.mock.method(product, 'save', async () => product);
  const exists = t.mock.method(Product, 'exists', async () => null);
  const result = await productService.updateProduct(String(product._id), { product_name: 'New name' });
  assert.equal(result.product_name, 'New name'); assert.equal(result.slug, 'shared-bookmark');
  assert.equal(exists.mock.callCount(), 0);
});

test('an explicit slug update works independently of name and allocates a unique slug on collision', async t => {
  const product = new Product({ product_name: 'Original name', slug: 'original-slug', price: 100 });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  t.mock.method(product, 'save', async () => product);
  t.mock.method(Product, 'exists', async filter => filter.slug === 'requested-slug' ? { _id: id } : null);
  const result = await productService.updateProduct(String(product._id), { slug: 'requested-slug' });
  assert.equal(result.slug, 'requested-slug-1'); assert.equal(result.product_name, 'Original name');
});
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

test('product query validates range, sort fields and catalog references', () => {
  for (const query of [{ minPrice: -1 }, { minPrice: 20, maxPrice: 10 }, { sortBy: '$where' }, { sortOrder: 'bad' }, { category: 'bad' }]) {
    assert.equal(getProductsQuerySchema.safeParse(query).success, false);
  }
  const parsed = getProductsQuerySchema.parse({ search: ' Case.* ', category: id, brand: id, minPrice: '0', maxPrice: '100', sortBy: 'price', sortOrder: 'asc', sku: 'abc-1', color: 'red', size: 'XL' });
  const query = buildProductQuery(parsed);
  assert.deepEqual(query.$expr, { $and: [{ $gte: [effectivePriceExpression, 0] }, { $lte: [effectivePriceExpression, 100] }] });
  assert.equal(query.product_name.$regex, 'Case\\.\\*');
  assert.equal(query.category, id);
  assert.equal(query.variants.$elemMatch.sku, 'ABC-1');
  assert.ok(query.variants.$elemMatch.color && query.variants.$elemMatch.size);
  assert.deepEqual(buildProductSort(parsed), { price: 1, _id: 1 });
  assert.deepEqual(buildProductSort({}), { createdAt: -1, _id: -1 });
});

test('list uses the same combined filters for rows and total with stable sorting', async t => {
  const filters = getProductsQuerySchema.parse({ page: 2, limit: 20, minPrice: 5, sortBy: 'product_name', sortOrder: 'asc' });
  const expected = buildProductQuery(filters);
  const chain = { sort(value) { assert.deepEqual(value, { product_name: 1, _id: 1 }); return this; }, skip(value) { assert.equal(value, 20); return this; }, limit(value) { assert.equal(value, 20); return this; }, populate() { return this; }, lean: async () => [] };
  t.mock.method(Product, 'find', query => { assert.deepEqual(query, expected); return chain; });
  t.mock.method(Product, 'countDocuments', async query => { assert.deepEqual(query, expected); return 25; });
  assert.deepEqual((await productService.getAllProducts(filters)).pagination, { page: 2, limit: 20, total: 25, totalPages: 2 });
});

test('statistics returns an empty catalog as zero and aggregates globally', async t => {
  const aggregate = t.mock.method(Product, 'aggregate', async pipeline => { assert.equal(pipeline[0].$group.total.$sum, 1); return []; });
  assert.deepEqual(await productService.getStatistics(), { total: 0, active: 0, outOfStock: 0, stockUnits: 0 });
  aggregate.mock.restore();
  t.mock.method(Product, 'aggregate', async () => [{ total: 5, active: 3, outOfStock: 2, stockUnits: 12 }]);
  assert.equal((await productService.getStatistics()).stockUnits, 12);
});

function galleryProduct() {
  return new Product({ product_name: 'Case', slug: 'case', category: id, brand: id, model_year: 2026, thumbnail: 'https://images.test/one.png',
    images: [{ public_id: 'folder/one', secure_url: 'https://images.test/one.png' }, { public_id: 'folder/two', secure_url: 'https://images.test/two.png' }] });
}
test('gallery deletion only deletes an owned image and updates its thumbnail', async t => {
  const product = galleryProduct();
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(product, 'save', async () => product);
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async publicId => { assert.equal(publicId, 'folder/one'); return { result: 'ok' }; });
  await assert.rejects(removeProductImage(id, 'unowned/image'), { status: 404 });
  assert.equal(destroy.mock.callCount(), 0);
  const result = await removeProductImage(id, 'folder/one');
  assert.equal(result.cleanupPending, false);
  assert.equal(result.product.images.length, 1);
  assert.equal(result.product.thumbnail, 'https://images.test/two.png');
});
test('gallery deletion blocks variant references and reports storage cleanup failures honestly', async t => {
  const product = galleryProduct();
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(product, 'save', async () => product);
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async () => { throw new Error('Storage unavailable'); });
  product.variants.push({ sku: 'CASE-1', price: 1, image: product.thumbnail });
  await assert.rejects(removeProductImage(id, 'folder/one'), { status: 409 });
  assert.equal(destroy.mock.callCount(), 0);
  product.variants.splice(0);
  assert.equal((await removeProductImage(id, 'folder/one')).cleanupPending, true);
});
test('upload validates file content and enforces gallery limits without a network request', async t => {
  assert.throws(() => validateProductImage({ mimetype: 'image/png', buffer: Buffer.from('not-png') }), { status: 400 });
  assert.throws(() => validateProductImage({ mimetype: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }), { status: 413 });
  const product = galleryProduct();
  while (product.images.length < 8) product.images.push({ public_id: String(product.images.length), secure_url: 'https://images.test/image.png' });
  t.mock.method(Product, 'findById', async () => product);
  const file = { mimetype: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  await assert.rejects(addProductImage(id, file), { status: 409 });
});
test('upload stores Cloudinary metadata and cleans up the uploaded asset after database failure', async t => {
  const product = galleryProduct();
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(product, 'save', async () => { throw new Error('Save failed'); });
  t.mock.method(cloudinary.uploader, 'upload_stream', (_options, callback) => ({ end() { callback(null, { public_id: 'folder/new', secure_url: 'https://images.test/new.png' }); } }));
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async publicId => { assert.equal(publicId, 'folder/new'); return { result: 'ok' }; });
  await assert.rejects(addProductImage(id, { mimetype: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }), /Save failed/);
  assert.equal(destroy.mock.callCount(), 1);
});

test('stock filters validate and match total product inventory including low-stock boundaries', () => {
  assert.equal(getProductsQuerySchema.safeParse({ stockStatus: 'invalid' }).success, false);
  for (const [status, expected] of [['in_stock', { $gt: 0 }], ['low_stock', { $gte: 1, $lte: 5 }], ['out_of_stock', 0]]) {
    const parsed = getProductsQuerySchema.parse({ stockStatus: status, search: 'Case' });
    const query = buildProductQuery(parsed);
    assert.deepEqual(query.stock, expected);
    assert.equal(query.product_name.$regex, 'Case');
  }
  assert.equal(buildProductQuery({}).stock, undefined);
});

test('variant stock updates retain an existing thumbnail and clear compare-at price explicitly', async t => {
  const { default: mongoose } = await import('mongoose');
  const { SystemLock } = await import('../dist/models/system-locks.model.js');
  const { Order } = await import('../dist/models/orders.model.js');
  const { updateProductSchema } = await import('../dist/validations/products.validation.js');
  const product = new Product({ product_name: 'Case', slug: 'case', category: id, brand: id, model_year: 2026,
    price: 100, stock: 5, thumbnail: 'https://images.test/custom.png', variants: [{ sku: 'CASE-1', price: 100, compare_at_price: 150, stock: 5, image: 'https://images.test/variant.png' }] });
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  t.mock.method(Product, 'exists', async () => null);
  t.mock.method(Order, 'exists', async () => null);
  t.mock.method(product, 'save', async () => product);
  const variantId = String(product.variants[0]._id);
  const update = updateProductSchema.parse({ expectedVersion: 0, variants: [{ _id: variantId, sku: 'CASE-1', price: 100, stock: 4, compare_at_price: null }] });
  await productService.updateProduct(String(product._id), update);
  assert.equal(product.thumbnail, 'https://images.test/custom.png');
  assert.equal(product.stock, 4);
  assert.equal(product.variants[0].compare_at_price, null);
  product.thumbnail = null;
  await productService.updateProduct(String(product._id), { expectedVersion: 0, variants: [{ _id: variantId, sku: 'CASE-1', price: 100, stock: 4 }] });
  assert.equal(product.thumbnail, 'https://images.test/variant.png');
  await productService.updateProduct(String(product._id), { expectedVersion: 0, thumbnail: null, variants: [{ _id: variantId, sku: 'CASE-1', price: 100, stock: 4 }] });
  assert.equal(product.thumbnail, null);
});

test('image deletion refuses to unlink when its durable cleanup task cannot be saved', async t => {
  const product = galleryProduct();
  t.mock.method(Product, 'findById', async () => product);
  const save = t.mock.method(product, 'save', async () => product);
  t.mock.method(ImageCleanupJob, 'bulkWrite', async () => { throw new Error('Queue unavailable'); });
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async () => ({ result: 'ok' }));
  await assert.rejects(removeProductImage(id, 'folder/one'), /Queue unavailable/);
  assert.equal(product.images.length, 2);
  assert.equal(save.mock.callCount(), 0); assert.equal(destroy.mock.callCount(), 0);
});

test('a failed upload save queues storage cleanup when immediate compensation fails', async t => {
  const product = galleryProduct();
  t.mock.method(Product, 'findById', async () => product);
  t.mock.method(product, 'save', async () => { throw new Error('Version conflict'); });
  t.mock.method(cloudinary.uploader, 'upload_stream', (_options, callback) => ({ end() { callback(null, { public_id: 'folder/pending', secure_url: 'https://images.test/pending.png' }); } }));
  t.mock.method(cloudinary.uploader, 'destroy', async () => { throw new Error('Storage unavailable'); });
  const queue = t.mock.method(ImageCleanupJob, 'bulkWrite', async operations => {
    assert.equal(operations[0].updateOne.filter.publicId, 'folder/pending'); return {};
  });
  await assert.rejects(addProductImage(id, { mimetype: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }), /Version conflict/);
  assert.equal(queue.mock.callCount(), 1);
});
