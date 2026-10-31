import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import app from '../dist/app.js';
import { User } from '../dist/models/users.model.js';
import { Customer } from '../dist/models/customers.model.js';
import { generateRefreshToken, generateAccessToken, hashToken } from '../dist/utils/token.js';

test('store refresh/logout cannot revoke admin renewal after its access token expires, even with identical account IDs', async t => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
  const id = 'a'.repeat(24);
  const adminToken = generateRefreshToken({ id, tokenVersion: 3 });
  const customerToken = generateRefreshToken({ id, tokenVersion: 3, accountType: 'customer' });
  const admin = new User({ _id: id, role: 'admin', active: true, tokenVersion: 3, refreshToken: hashToken(adminToken), email: 'admin@example.test' });
  const customer = new Customer({ _id: id, isActive: true, accountEnabled: true, tokenVersion: 3, refreshToken: hashToken(customerToken), email: 'buyer@example.test' });
  t.mock.method(User, 'findById', () => ({ select: async () => admin }));
  t.mock.method(Customer, 'findById', () => ({ select: async () => customer }));
  const adminRevoke = t.mock.method(User, 'findByIdAndUpdate', async () => assert.fail('Customer logout must not revoke User sessions'));
  t.mock.method(Customer, 'findByIdAndUpdate', async () => { customer.refreshToken = null; customer.tokenVersion++; });
  for (const [model, account] of [[User, admin], [Customer, customer]]) {
    t.mock.method(model, 'findOneAndUpdate', async (filter, update) => {
      if (filter.refreshToken !== account.refreshToken) return null;
      account.refreshToken = update.$set.refreshToken;
      return account;
    });
  }
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const cookie = `adminRefreshToken=${adminToken}; customerRefreshToken=${customerToken}`;
  const post = (path, area, authorization) => fetch(base + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: 'http://localhost:5173',
    'X-Auth-Transport': 'cookie', 'X-Login-Area': area, Cookie: cookie,
    ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
  }, body: '{}' });
  const customerRefresh = await post('/customer-auth/refresh', 'storefront');
  assert.equal(customerRefresh.status, 200);
  assert.match(customerRefresh.headers.get('set-cookie'), /^customerRefreshToken=/);
  assert.equal(admin.refreshToken, hashToken(adminToken));
  const customerLogout = await post('/customer-auth/logout', 'storefront', generateAccessToken({ id, tokenVersion: 3, accountType: 'customer' }));
  assert.equal(customerLogout.status, 200);
  assert.match(customerLogout.headers.get('set-cookie'), /^customerRefreshToken=/);
  const expired = jwt.sign({ userId: id, version: 3, accountType: 'user' }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal((await fetch(base + '/auth/me', { headers: { Authorization: `Bearer ${expired}`, 'X-Login-Area': 'admin' } })).status, 401);
  const renewal = await post('/auth/refresh', 'admin');
  assert.equal(renewal.status, 200);
  assert.match(renewal.headers.get('set-cookie'), /^adminRefreshToken=/);
  const result = await renewal.json();
  assert.equal(result.data.refreshToken, undefined);
  const me = await fetch(base + '/auth/me', { headers: { Authorization: `Bearer ${result.data.accessToken}`, 'X-Login-Area': 'admin' } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.role, 'admin');
  assert.equal(adminRevoke.mock.callCount(), 0);
});
