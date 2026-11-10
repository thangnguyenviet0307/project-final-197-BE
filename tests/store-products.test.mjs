import { categoryMembership } from '../dist/utils/products/catalog-reference.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import app from '../dist/app.js';
import Product from '../dist/models/products/products.model.js';
import {
  publicProductFields,
  publicProductListFields,
  listStoreProducts,
  relatedStoreProducts,
} from '../dist/services/products/store-products.service.js';
import { Categories } from '../dist/models/categories/categories.model.js';
import { BrandModel } from '../dist/models/brands/brands.model.js';

function mockReferences(t) {
  for (const model of [Categories, BrandModel])
    t.mock.method(model, 'distinct', async (_field, query) => {
      if (!query.name) assert.equal(query.isActive, true);
      assert.deepEqual(query.isDeleted, { $ne: true });
      return ['active-id'];
    });
}

test('catalog lists exclude large editorial fields in MongoDB, including price sorting; indexing opts in', async (t) => {
  for (const model of [Categories, BrandModel])
    t.mock.method(model, 'distinct', async () => ['a'.repeat(24)]);
  const originalFind = Product.find.bind(Product);
  const find = t.mock.method(Product, 'find', () => {
    const query = originalFind();
    query.lean = async () => {
      const projection = query.projection();
      for (const field of ['description', 'warrantyInformation', 'shippingInformation', 'returnPolicy'])
        assert.equal(projection[field], includeContent ? 1 : undefined);
      assert.equal(projection.product_name, 1);
      return [];
    };
    return query;
  });
  t.mock.method(Product, 'countDocuments', async () => 0);
  t.mock.method(Product, 'aggregate', async () => []);
  let includeContent = false;
  await listStoreProducts({});
  await listStoreProducts({ sortBy: 'price', sortOrder: 'asc' });
  includeContent = true;
  await listStoreProducts({}, undefined, { includeContent: true });
  assert.ok(find.mock.callCount() >= 3);
});

test('public catalog is anonymous, paginated and active-only; admin stays protected', async (t) => {
  mockReferences(t);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products`;
  const chain = {
    select(fields) {
      assert.equal(fields, publicProductListFields);
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    skip(n) {
      assert.equal(n, 2);
      return this;
    },
    limit(n) {
      assert.equal(n, 2);
      return this;
    },
    lean: async () => [],
  };
  t.mock.method(Product, 'find', (query) => {
    assert.equal(query.is_active, true);
    assert.equal(query.$and[0].$and[1].$or[0].product_name.$regex, 'Case');
    assert.deepEqual(query.$and[1].category, { $in: ['active-id'] });
    return chain;
  });
  t.mock.method(Product, 'countDocuments', async (query) => {
    assert.equal(query.is_active, true);
    return 3;
  });
  const response = await fetch(base + '/public?page=2&limit=2&search=Case');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).pagination, {
    page: 2,
    limit: 2,
    total: 3,
    totalPages: 2,
  });
  assert.equal((await fetch(base + '/public?limit=101')).status, 400);
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(base + '/statistics')).status, 401);
  assert.equal(
    (
      await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    401
  );
});

test('public detail cannot read an inactive product and excludes import/internal fields', async (t) => {
  mockReferences(t);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  t.mock.method(Product, 'findOne', (query) => {
    assert.deepEqual(query, {
      slug: 'hidden-product',
      is_active: true,
      on_sale: { $ne: false },
      category: { $in: ['active-id'] },
      brand: { $in: ['active-id'] },
    });
    return {
      select(fields) {
        assert.equal(fields, publicProductFields);
        assert.ok(!fields.split(' ').includes('__v'));
        assert.ok(!fields.split(' ').includes('external_id'));
        return this;
      },
      populate() {
        return this;
      },
      lean: async () => null,
    };
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products/public`;
  assert.equal((await fetch(base + '/hidden-product')).status, 404);
  for (const path of ['metrics', 'reviews', 'related'])
    assert.equal((await fetch(base + '/hidden-product/' + path)).status, 404);
  assert.equal(
    (await fetch(base + '/hidden-product/reviews?page=0')).status,
    400
  );
  assert.equal(
    (await fetch(base + '/hidden-product/reviews?limit=6')).status,
    400
  );
  assert.equal((await fetch(base + '/x')).status, 400);
});

test('related products match only the same category, exclude self and return at most five public products', async (t) => {
  mockReferences(t);
  const chain = {
    select() {
      return this;
    },
    populate() {
      return this;
    },
    sort(value) {
      assert.deepEqual(value, { createdAt: -1, _id: -1 });
      return this;
    },
    limit(n) {
      assert.equal(n, 5);
      return this;
    },
    lean: async () => [],
  };
  const find = t.mock.method(Product, 'find', (query) => {
    assert.deepEqual(query._id, { $ne: 'current' });
    assert.equal(query.is_active, true);
    assert.deepEqual(query.$and[0].category, { $in: ['active-id'] });
    assert.deepEqual(query.$and[1], categoryMembership(['category-id']));
    return chain;
  });
  await relatedStoreProducts({
    _id: 'current',
    category: { _id: 'category-id' },
    tags: ['wireless', 'audio'],
  });
  find.mock.restore();
  t.mock.method(Product, 'find', query => { assert.deepEqual(query.$and[1], categoryMembership(['category-id'])); return chain; });
  await relatedStoreProducts({ _id: 'current', category: 'category-id', tags: [] });
});
