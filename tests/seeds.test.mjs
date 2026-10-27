import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSeedData } from '../dist/seeds/generate.js';
import { formatSeedError } from '../dist/seeds/errors.js';
import { createNameAllocator, cleanLegacySeedName } from '../dist/seeds/names.js';
import { buildSlug } from '../dist/helpers/buildSlug.helper.js';
import { Types } from 'mongoose';
import { planProductMetadata, backfillProductGuard, fakerProductFilter } from '../dist/seeds/backfill-products.js';

test('Faker backfill fills missing metadata and remains idempotent with raw stored documents', () => {
  const legacy = { _id: new Types.ObjectId(), __v: 3, product_name: 'Existing product', price: 99000, stock: 5,
    model_year: 2024, variants: [{ sku: 'EXISTING', stock: 5 }], images: [] };
  const patch = planProductMetadata(legacy, 'beauty');
  assert.equal(patch.sku, `SEED-LEGACY-${String(legacy._id).toUpperCase()}`);
  assert.equal(patch.currency, 'VND');
  assert.equal(patch.minimumOrderQuantity, 1);
  assert.ok(patch.tags.includes('beauty'));
  for (const field of ['price', 'stock', 'model_year', 'variants', 'images', 'source', 'external_id', 'rating', 'soldCount', 'reviewCount']) {
    assert.equal(Object.hasOwn(patch, field), false, `${field} must not be overwritten or fabricated`);
  }
  assert.deepEqual(planProductMetadata({ ...legacy, ...patch }, 'beauty'), {});
  const guard = backfillProductGuard(legacy, patch);
  assert.equal(guard.__v, 3);
  assert.ok(guard.$and.some(condition => condition.sku?.$exists === false));
});

test('Faker backfill preserves populated metadata and valid zero values but fills empty legacy defaults', () => {
  const raw = { _id: new Types.ObjectId(), sku: 'CUSTOM-SKU', barcode: '000123', currency: 'VND', tags: ['custom'], weight: 0,
    dimensions: { width: 1, height: 2, depth: 3 }, warrantyInformation: 'Custom policy', shippingInformation: 'Custom delivery',
    returnPolicy: 'Custom returns', minimumOrderQuantity: 7, model_year: null, sourceImages: [] };
  assert.deepEqual(planProductMetadata(raw), {});
  const patch = planProductMetadata({ ...raw, weight: null, tags: [], barcode: '' });
  assert.deepEqual(Object.keys(patch).sort(), ['barcode', 'tags', 'weight']);
  const guard = backfillProductGuard({ ...raw, weight: null }, patch);
  assert.ok(guard.$and.some(condition => condition.weight?.$exists === true && condition.weight?.$eq === null));
});

test('Faker backfill selects only exact native seed signatures and excludes imported sources', () => {
  const signatures = fakerProductFilter.$or;
  assert.deepEqual(fakerProductFilter.source, { $exists: false });
  assert.equal(signatures[0]['variants.sku'].test('SEED-A1234567-1234-5678-ABCD-A123456789AB-0-1'), true);
  assert.equal(signatures[0]['variants.sku'].test('SEED-MANUAL-SKU'), false);
  assert.equal(signatures[1].sku.test('SEED-A1234567-1234-5678-ABCD-A123456789AB-PRODUCT-0'), true);
  assert.equal(signatures[2].slug.test('seed-product-a1234567-0'), true);
  assert.equal(signatures[2].slug.test('normal-catalog-product'), false);
});

test('readable names reserve existing names and normalized slugs without UUID suffixes', () => {
  const allocate = createNameAllocator([{ name: 'Music', slug: 'music' }, { name: 'Music (2)', slug: 'music-2' }]);
  assert.deepEqual(allocate('Music'), { name: 'Music (3)', slug: 'music-3' });
  assert.deepEqual(allocate('Music'), { name: 'Music (4)', slug: 'music-4' });
  const legacy = 'Music ca8e3912-c78d-44ba-889a-1562ab003d1f-3';
  assert.equal(cleanLegacySeedName(legacy, 'music-ca8e3912-c78d-44ba-889a-1562ab003d1f-3'), 'Music');
  assert.equal(cleanLegacySeedName(legacy, 'manually-created-category'), undefined);
  assert.equal(cleanLegacySeedName('Music (2)', 'music-2'), undefined);
  assert.equal(cleanLegacySeedName('Phone 2026', 'phone-2026'), undefined);
  const oldSlug = 'seed-product-ca8e3912-c78d-44ba-889a-1562ab003d1f-1';
  const oldName = 'Fantastic Bamboo Fish ca8e3912-c78d-44ba-889a-1562ab003d1f-1';
  assert.equal(cleanLegacySeedName(oldName, oldSlug), 'Fantastic Bamboo Fish');
  const cleanedName = cleanLegacySeedName('Fantastic Bamboo Fish', oldSlug);
  assert.deepEqual(createNameAllocator()(cleanedName), {
    name: 'Fantastic Bamboo Fish', slug: 'fantastic-bamboo-fish',
  });
  assert.deepEqual(createNameAllocator()('Kính cường lực'), { name: 'Kính cường lực', slug: 'kinh-cuong-luc' });
});

test('seed errors report driver diagnostics and redact credentials', () => {
  const error = new Error('Cannot connect mongodb+srv://user:secret@cluster/db password-value');
  error.name = 'MongoServerSelectionError';
  const message = formatSeedError(error, { SEED_PASSWORD: 'password-value' });
  assert.match(message, /MongoServerSelectionError: Cannot connect/);
  assert.ok(!message.includes('user:secret'));
  assert.ok(!message.includes('password-value'));
});

test('catalog seeding creates only brands, categories and products with valid metadata and batch markers', async () => {
  const data = await generateSeedData();
  assert.deepEqual(Object.keys(data).sort(), ['brands', 'categories', 'products']);
  assert.equal(data.brands.length, 8);
  assert.equal(data.categories.length, 10);
  assert.equal(data.products.length, 50);
  const batch = data.brands[0].seedBatch;
  assert.match(batch, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i);
  const brands = new Set(data.brands.map(row => String(row._id)));
  const categories = new Set(data.categories.map(row => String(row._id)));
  const skus = new Set();
  for (const documents of Object.values(data)) for (const document of documents) {
    await document.validate();
    assert.equal(document.seedBatch, batch);
    assert.equal(document.password, undefined);
  }
  for (const category of data.categories) if (category.parent) assert.ok(categories.has(String(category.parent)));
  for (const product of data.products) {
    assert.ok(brands.has(String(product.brand))); assert.ok(categories.has(String(product.category)));
    assert.equal(product.currency, 'VND');
    assert.ok(product.weight >= 0 && product.dimensions.width >= 0);
    assert.ok(product.barcode && product.tags.includes('seed'));
    assert.ok(product.warrantyInformation && product.shippingInformation && product.returnPolicy);
    assert.ok(Number.isSafeInteger(product.minimumOrderQuantity) && product.minimumOrderQuantity >= 1);
    assert.equal(product.stock, product.variants.reduce((sum, variant) => sum + variant.stock, 0));
    assert.deepEqual(product.images, []);
    assert.equal(product.source, undefined);
    for (const variant of product.variants) {
      assert.ok(!skus.has(variant.sku)); skus.add(variant.sku);
      assert.ok(variant.stock >= 100 && variant.stock <= 200);
      assert.ok(variant.compare_at_price >= variant.price);
    }
  }
  const next = await generateSeedData({
    brands: data.brands.map(row => ({ name: row.name, slug: row.slug })),
    categories: data.categories.map(row => ({ name: row.name, slug: row.slug })),
    products: data.products.map(row => ({ name: row.product_name, slug: row.slug })),
  });
  for (const name of ['brands', 'categories', 'products']) {
    const prior = new Set(data[name].map(row => row.slug));
    for (const row of next[name]) assert.ok(!prior.has(row.slug));
  }
  assert.notEqual(next.brands[0].seedBatch, batch);
});
