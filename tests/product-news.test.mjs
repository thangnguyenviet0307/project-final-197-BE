import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import app from '../dist/app.js';
import Product from '../dist/models/products.model.js';
import { User } from '../dist/models/users.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { productNewsSchema } from '../dist/validations/product-news.validation.js';

test('product news inputs require version, unique IDs and at most five selections', () => {
  const id = 'a'.repeat(24);
  assert.deepEqual(productNewsSchema.parse({ articleIds: [], expectedVersion: 0 }).articleIds, []);
  for (const input of [{ articleIds: [] }, { articleIds: [id, id.toUpperCase()], expectedVersion: 0 }, { articleIds: ['bad'], expectedVersion: 0 }, { articleIds: [], expectedVersion: -1 }, { articleIds: [], expectedVersion: 0, price: 1 }, { articleIds: Array.from({ length: 6 }, (_, i) => String(i).repeat(24)), expectedVersion: 0 }]) {
    assert.equal(productNewsSchema.safeParse(input).success, false);
  }
});

test('public news is anonymous but staff/customers cannot read or write product news management', async t => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const id = 'a'.repeat(24);
  let role = 'staff';
  const user = new User({ _id: id, email: 'fixture@example.com', firstName: 'Fixture', lastName: 'Staff', password: 'unused', active: true, role, tokenVersion: 0 });
  t.mock.method(User, 'findById', () => ({ select: async () => ({ ...user.toObject(), tokenVersion: 0, role }) }));
  t.mock.method(Categories, 'distinct', async () => []);
  t.mock.method(BrandModel, 'distinct', async () => []);
  t.mock.method(Product, 'findOne', () => ({ select() { return this; }, lean: async () => ({ relatedNewsIds: [] }) }));
  const adminRead = t.mock.method(Product, 'findById', () => ({ select() { return this; }, lean: async () => null }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products`;
  try {
    assert.equal((await fetch(`${base}/public/fixture/news`)).status, 200);
    assert.equal((await fetch(`${base}/${id}/news`)).status, 401);
    for (const accountType of ['user', 'customer']) {
      const token = generateAccessToken({ id, accountType, tokenVersion: 0 });
      for (const method of ['GET', 'PATCH']) {
        const response = await fetch(`${base}/${id}/news`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ articleIds: [], expectedVersion: 0 }) } : {}) });
        assert.equal(response.status, 403);
      }
    }
    assert.equal(adminRead.mock.callCount(), 0);
    role = 'admin';
    const token = generateAccessToken({ id, tokenVersion: 0 });
    assert.equal((await fetch(`${base}/${id}/news`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
    assert.equal(adminRead.mock.callCount(), 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
