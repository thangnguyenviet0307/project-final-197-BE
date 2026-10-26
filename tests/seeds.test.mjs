import assert from 'node:assert/strict';
import { test } from 'node:test';
import argon2 from 'argon2';
import { generateSeedData } from '../dist/seeds/generate.js';
import { OrderStatus } from '../dist/types/orders.type.js';
import { formatSeedError } from '../dist/seeds/errors.js';
import { createNameAllocator, cleanLegacySeedName } from '../dist/seeds/names.js';
import { buildSlug } from '../dist/helpers/buildSlug.helper.js';

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

test('seed documents have valid relations, inventory, assignments and hashed passwords', async () => {
  const data = await generateSeedData('Test-only-password-123');
  const nextBatch = await generateSeedData('Test-only-password-123', {
    brands: data.brands.map(value => ({ name: value.name, slug: value.slug })),
    categories: data.categories.map(value => ({ name: value.name, slug: value.slug })),
    products: data.products.map(value => ({ name: value.product_name, slug: value.slug })),
  });
  const productNames = [...data.products, ...nextBatch.products].map(product => product.product_name);
  assert.equal(new Set(productNames).size, productNames.length, 'Product names must be unique across seed runs');
  for (const name of productNames) assert.ok(name.length <= 255);
  const uuid = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  for (const value of [...data.brands, ...data.categories, ...data.products]) {
    assert.ok(!uuid.test(value.name ?? value.product_name));
    assert.ok(!uuid.test(value.slug));
    assert.equal(value.slug, buildSlug(value.name ?? value.product_name));
  }
  for (const collection of ['brands', 'categories']) {
    const names = [...data[collection], ...nextBatch[collection]].map(document => document.name);
    assert.equal(new Set(names).size, names.length, `${collection} names must be unique across seed runs`);
  }
  const ids = documents => new Set(documents.map(document => String(document._id)));
  const brands = ids(data.brands);
  const categories = ids(data.categories);
  const customers = ids(data.customers);
  const staff = new Set(data.users.filter(user => user.role === 'staff').map(user => String(user._id)));
  for (const user of data.users) assert.equal(await argon2.verify(user.password, 'Test-only-password-123'), true);
  for (const category of data.categories) {
    if (category.parent) assert.ok(categories.has(String(category.parent)));
  }
  for (const product of data.products) {
    assert.ok(product.variants.length > 0, 'Every seed product needs a SKU for existing unique indexes');
    assert.ok(brands.has(String(product.brand)));
    assert.ok(categories.has(String(product.category)));
    assert.ok(product.stock >= 0);
    if (product.variants.length) assert.equal(product.stock, product.variants.reduce((sum, variant) => sum + variant.stock, 0));
  }
  const skus = [...data.products, ...nextBatch.products].flatMap(product => product.variants.map(variant => variant.sku));
  assert.equal(new Set(skus).size, skus.length, 'Variant SKUs must be unique across seed runs');
  const activeCounts = new Map();
  const reserved = new Map();
  const now = new Date();
  for (const order of data.orders) {
    assert.ok(customers.has(String(order.customerId)));
    assert.match(order.orderCode, /^ORD-[A-HJ-NP-Z2-9]{6}$/);
    const customer = data.customers.find(customer => customer._id.equals(order.customerId));
    assert.deepEqual(order.customerSnapshot.toObject(), {
      firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone,
    });
    assert.ok(order.requireDate >= order.orderDate);
    if (order.orderStatus === OrderStatus.Completed) {
      assert.ok(order.shippingDate >= order.orderDate && order.shippingDate <= now);
      assert.ok(order.userId);
    } else assert.equal(order.shippingDate, undefined);
    if (order.orderStatus === OrderStatus.Rejected) assert.ok(order.cancellationReason);
    if (order.userId) {
      const id = String(order.userId);
      assert.ok(staff.has(id));
      if ([OrderStatus.Pending, OrderStatus.Processing].includes(order.orderStatus)) activeCounts.set(id, (activeCounts.get(id) ?? 0) + 1);
    }
    for (const item of order.orderItems) {
      const product = data.products.find(product => product._id.equals(item.productId));
      assert.ok(product);
      if (item.variantId) {
        const variant = product.variants.id(item.variantId);
        assert.ok(variant);
        assert.equal(item.price, variant.price);
        assert.equal(item.sku, variant.sku);
        assert.equal(item.discount, product.discount);
        assert.equal(item.productName, product.product_name);
        assert.deepEqual(item.selectedOptions, { ...variant.attributes, color: variant.color, size: variant.size });
        if (order.orderStatus !== OrderStatus.Rejected) {
          reserved.set(variant.sku, (reserved.get(variant.sku) ?? 0) + item.quantity);
        }
      } else assert.equal(product.variants.length, 0);
    }
  }
  for (const product of data.products) {
    for (const variant of product.variants) {
      const initialStock = variant.stock + (reserved.get(variant.sku) ?? 0);
      assert.ok(initialStock >= 100 && initialStock <= 200);
    }
  }
  const phones = [...data.customers, ...data.users].map(document => document.phone);
  assert.equal(new Set(phones).size, phones.length);
  for (const count of activeCounts.values()) assert.ok(count <= 5);
});
