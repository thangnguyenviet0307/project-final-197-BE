import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Customer } from '../dist/models/customers.model.js';
import { User } from '../dist/models/users.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { hasPermission } from '../dist/config/rolePermissions.js';
import { Permission } from '../dist/types/permissions.type.js';
import mongoose from 'mongoose';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { bootstrapAdmin } from '../dist/services/auth.service.js';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');
let server, base;
const input = { firstName: 'An', lastName: 'Nguyen', email: 'buyer@example.com', password: 'Customer123' };
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const register = body => fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('public registration hashes passwords, creates customers and returns no credentials', async t => {
  t.mock.method(User, 'exists', async () => null);
  t.mock.method(Customer, 'exists', async () => null);
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
  let contact;
  t.mock.method(Customer, 'create', async values => { contact = values[0]; return [new Customer(contact)]; });
  let saved;
  t.mock.method(User, 'create', async values => { saved = values[0]; return [new User(saved)]; });
  const response = await register(input);
  assert.equal(response.status, 201);
  assert.equal(saved.role, 'customer');
  assert.equal(saved.active, true);
  assert.equal(saved.mustChangePassword, false);
  assert.equal(await argon2.verify(saved.password, input.password), true);
  const body = await response.json();
  assert.equal(body.data.role, 'customer');
  assert.equal(body.data.email, input.email);
  assert.equal(String(contact.accountId), body.data.id);
  for (const secret of ['password', 'tokenVersion', 'refreshToken', 'accessToken']) assert.equal(body.data[secret], undefined);
  assert.equal(response.headers.get('set-cookie'), null);
});
test('registration rejects privilege injection and duplicate email races', async t => {
  for (const extra of [{ role: 'admin' }, { active: true }, { tokenVersion: 0 }]) {
    assert.equal((await register({ ...input, ...extra })).status, 400);
  }
  t.mock.method(User, 'exists', async () => null);
  t.mock.method(Customer, 'exists', async () => null);
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
  t.mock.method(User, 'create', async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); });
  assert.equal((await register(input)).status, 409);
});
test('customers can read and update their own profile but cannot use staff APIs', async t => {
  const customer = new User({ ...input, role: 'customer', active: true, tokenVersion: 0 });
  t.mock.method(User, 'findById', () => ({ select: async () => customer }));
  const headers = { Authorization: `Bearer ${generateAccessToken({ id: String(customer._id), tokenVersion: 0 })}`, 'Content-Type': 'application/json' };
  const me = await fetch(base + '/auth/me', { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.role, 'customer');
  const profile = { firstName: 'Updated', lastName: 'Nguyen', personalEmail: '', phone: '0901234567', location: '', bio: '' };
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter._id, String(customer._id));
    assert.equal(update.$set.role, undefined);
    return new User({ ...customer.toObject(), ...profile });
  });
  const updated = await fetch(base + '/auth/me', { method: 'PATCH', headers, body: JSON.stringify(profile) });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.firstName, 'Updated');
  for (const path of ['/orders', '/products', '/users', '/customers', '/brands']) assert.equal((await fetch(base + path, { headers })).status, 403);
  for (const permission of Object.values(Permission)) assert.equal(hasPermission('customer', permission), false);
});
test('customer registrations do not prevent initializing the first administrator', async t => {
  const secret = randomBytes(32).toString('hex');
  const previous = process.env.BOOTSTRAP_SECRET;
  process.env.BOOTSTRAP_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.BOOTSTRAP_SECRET; else process.env.BOOTSTRAP_SECRET = previous; });
  t.mock.method(mongoose.connection, 'transaction', async fn => fn({}));
  t.mock.method(User, 'countDocuments', filter => {
    assert.deepEqual(filter, { role: { $in: ['admin', 'staff'] } });
    return { session: async () => 0 };
  });
  t.mock.method(SystemLock, 'create', async () => []);
  t.mock.method(User.prototype, 'save', async function () { return this; });
  const result = await bootstrapAdmin({ ...input, active: true }, secret);
  assert.equal(result.user.role, 'admin');
  assert.ok(result.accessToken);
});
