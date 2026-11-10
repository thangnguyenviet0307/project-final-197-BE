import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { User } from '../dist/models/users/users.model.js';
import Product from '../dist/models/products/products.model.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');

test('administrative slug reads retain private catalog visibility and existing authorization', async t => {
  const user = new User({ role: 'staff', active: true, tokenVersion: 0 });
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  const record = { _id: 'a'.repeat(24), slug: 'test-product', is_active: false, on_sale: false };
  const read = t.mock.method(Product, 'findOne', filter => {
    assert.deepEqual(filter, { slug: 'test-product' });
    return { populate: () => ({ lean: async () => record }) };
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products/by-slug/`;
  const token = type => generateAccessToken({ id: String(user._id), tokenVersion: 0, accountType: type });
  const headers = { Authorization: `Bearer ${token('user')}` };
  try {
    assert.equal((await fetch(base + 'test-product')).status, 401);
    assert.equal((await fetch(base + 'test-product', { headers: { Authorization: `Bearer ${token('customer')}` } })).status, 403);
    assert.equal(read.mock.callCount(), 0);
    const response = await fetch(base + 'test-product', { headers });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, record);
    assert.equal((await fetch(base + 'bad%24slug', { headers })).status, 400);
    assert.equal(read.mock.callCount(), 1);
    t.mock.method(Product, 'findOne', () => ({ populate: () => ({ lean: async () => null }) }));
    assert.equal((await fetch(base + 'missing-product', { headers })).status, 404);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
