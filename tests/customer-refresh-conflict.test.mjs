import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import app from '../dist/app.js';
import { Customer } from '../dist/models/customers.model.js';
import { generateRefreshToken, hashToken } from '../dist/utils/token.js';
import { refreshCustomer } from '../dist/services/customer-auth.service.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
test('customer rotation loser returns a controlled conflict while reuse is still unauthorized', async t => {
  const customer = new Customer({ firstName: 'Test', lastName: 'Buyer', email: 'test@example.com', accountEnabled: true, isActive: true, tokenVersion: 0 });
  const token = generateRefreshToken({ id: String(customer._id), accountType: 'customer', tokenVersion: 0 });
  customer.refreshToken = hashToken(token);
  t.mock.method(Customer, 'findById', () => ({ select: async () => customer }));
  t.mock.method(Customer, 'findOneAndUpdate', async filter => { assert.equal(filter.refreshToken, hashToken(token)); return null; });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/customer-auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Login-Area': 'storefront', 'X-Auth-Transport': 'cookie', Origin: 'http://localhost:5173', Cookie: `customerRefreshToken=${token}` }, body: '{}',
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_REFRESH_CONFLICT');
  assert.equal(response.headers.get('set-cookie'), null);
  customer.refreshToken = hashToken('a different rotated refresh token');
  await assert.rejects(refreshCustomer(token), { status: 401 });
});
