import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import argon2 from 'argon2';
import { User } from '../dist/models/users.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { UserService } from '../dist/services/users.service.js';
import { bootstrapAdmin, login } from '../dist/services/auth.service.js';
import { getPermissionsForRole } from '../dist/config/rolePermissions.js';
import { Permission } from '../dist/types/permissions.type.js';
import { createUserSchema, updateUserSchema, getUsersQuerySchema } from '../dist/validations/users.validation.js';
import { planFirstSuperAdmin } from '../scripts/promote-first-super-admin.mjs';
import { generateAccessToken } from '../dist/utils/token.js';
import { once } from 'node:events';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const owner = { id: 'a'.repeat(24), role: 'super_admin' };
const admin = { id: 'b'.repeat(24), role: 'admin' };
const staff = { id: 'c'.repeat(24), role: 'staff' };
const input = { firstName: 'First', lastName: 'Owner', email: 'owner@example.com', password: 'TemporaryPassword123', active: true };
const query = value => ({ session: async () => value });
function transaction(t) {
  const session = {};
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async work => work(session));
  return session;
}

test('Super Admin inherits every permission, and ordinary payloads cannot mint owners', async () => {
  assert.deepEqual(getPermissionsForRole('super_admin'), Object.values(Permission));
  assert.deepEqual(getPermissionsForRole('customer'), []);
  assert.equal(getPermissionsForRole('admin').includes(Permission.OwnershipTransfer), false);
  assert.equal(getPermissionsForRole('admin').includes(Permission.UserManageAdmins), false);
  assert.equal(createUserSchema.safeParse({ ...input, role: 'super_admin' }).success, false);
  assert.equal(updateUserSchema.safeParse({ role: 'super_admin' }).success, false);
  assert.equal(getUsersQuerySchema.safeParse({ role: 'super_admin' }).success, true);
  await new User({ ...input, role: 'super_admin' }).validate();
});

test('HTTP authentication accepts Super Admin and rejects Admin ownership transfer before service execution', async t => {
  const { default: app } = await import('../dist/app.js');
  let role = 'super_admin';
  const account = new User({ ...input, role, active: true, tokenVersion: 0 });
  t.mock.method(User, 'findById', () => ({ select: async () => ({ ...account.toObject(), role }) }));
  t.mock.method(UserService, 'getAllUsers', async () => ({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }));
  const transfer = t.mock.method(UserService, 'transferOwnership', async () => { throw new Error('Must not transfer'); });
  const token = generateAccessToken({ id: String(account._id), role, tokenVersion: 0 });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/users`;
  try {
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    role = 'admin';
    assert.equal((await fetch(`${base}/transfer-ownership`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUserId: staff.id, currentPassword: 'Password123' }) })).status, 403);
    assert.equal(transfer.mock.callCount(), 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('session revocation enforces role hierarchy and only clears sessions', async t => {
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter.role.$in, ['staff']);
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$set.password, undefined);
    assert.equal(update.$inc.tokenVersion, 1);
    return null;
  });
  await assert.rejects(UserService.revokeSessions(owner.id, admin), { status: 404 });
  await assert.rejects(UserService.revokeSessions(admin.id, staff), { status: 403 });
});

test('first protected bootstrap creates a Super Admin and a persistent initialization lock', async t => {
  const session = transaction(t);
  process.env.BOOTSTRAP_SECRET = randomBytes(32).toString('hex');
  t.mock.method(User, 'countDocuments', filter => {
    assert.deepEqual(filter.role.$in, ['super_admin', 'admin', 'staff']);
    return query(0);
  });
  t.mock.method(SystemLock, 'create', async (docs, options) => {
    assert.equal(docs[0]._id, 'admin-bootstrap'); assert.equal(options.session, session);
  });
  t.mock.method(User.prototype, 'save', async function (options) { assert.equal(options.session, session); return this; });
  const result = await bootstrapAdmin(input, process.env.BOOTSTRAP_SECRET);
  assert.equal(result.user.role, 'super_admin');
  assert.equal(result.user.password, undefined);
});

test('bootstrap never promotes or recreates an owner when administrative accounts already exist', async t => {
  transaction(t);
  process.env.BOOTSTRAP_SECRET = randomBytes(32).toString('hex');
  t.mock.method(User, 'countDocuments', () => query(1));
  const write = t.mock.method(SystemLock, 'create', async () => { throw new Error('Must not write'); });
  await assert.rejects(bootstrapAdmin(input, process.env.BOOTSTRAP_SECRET), { status: 403 });
  assert.equal(write.mock.callCount(), 0);
});

test('Super Admin can authenticate in the admin area', async t => {
  const user = new User({ ...input, role: 'super_admin', password: await argon2.hash(input.password) });
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(User, 'findOneAndUpdate', async () => user);
  assert.equal((await login(input.email, input.password, 'admin')).user.role, 'super_admin');
  await assert.rejects(login(input.email, input.password, 'storefront'), { status: 401 });
});

test('Admin cannot create Admin/Super Admin or change roles; Staff cannot manage accounts', async () => {
  await assert.rejects(UserService.createUser({ ...input, role: 'admin' }, admin), { status: 403 });
  await assert.rejects(UserService.createUser({ ...input, role: 'super_admin' }, owner), { status: 403 });
  await assert.rejects(UserService.updateUser(staff.id, { role: 'admin' }, admin), { status: 403 });
  await assert.rejects(UserService.createUser({ ...input, role: 'staff' }, staff), { status: 403 });
});

test('Admin resets/updates only staff; protected targets cannot match the write filter', async t => {
  t.mock.method(User, 'findOneAndUpdate', async filter => {
    assert.deepEqual(filter.role.$in, ['staff']);
    return null;
  });
  await assert.rejects(UserService.updateUser(owner.id, { password: 'Replacement123' }, admin), { status: 404 });
  await assert.rejects(UserService.updateUser(admin.id, { firstName: 'Changed' }, admin), { status: 404 });
});

test('no role can delete or deactivate the owner through ordinary management', async t => {
  transaction(t);
  t.mock.method(User, 'findById', () => query({ role: 'super_admin', active: true }));
  await assert.rejects(UserService.deleteUser(owner.id, owner), { status: 403 });
  await assert.rejects(UserService.updateUser(owner.id, { active: false }, owner), { status: 403 });
  await assert.rejects(UserService.deleteUser(owner.id, admin), { status: 403 });
});

test('ownership transfer verifies password and scopes both role changes in one transaction with session revocation', async t => {
  const session = transaction(t);
  const hash = await argon2.hash('OwnerPassword123');
  t.mock.method(User, 'findOne', () => ({ select: async () => ({ password: hash }) }));
  const updates = [];
  t.mock.method(User, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(options.session, session);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(update.$set.refreshToken, null);
    updates.push({ filter, update }); return { _id: filter._id };
  });
  await assert.rejects(UserService.transferOwnership(admin, staff.id, 'OwnerPassword123'), { status: 403 });
  await assert.rejects(UserService.transferOwnership(owner, owner.id, 'OwnerPassword123'), { status: 403 });
  await assert.rejects(UserService.transferOwnership(owner, staff.id, 'Incorrect'), { status: 400 });
  assert.equal(updates.length, 0);
  await UserService.transferOwnership(owner, staff.id, 'OwnerPassword123');
  assert.equal(updates[0].filter.role, 'super_admin');
  assert.equal(updates[0].filter.password, hash);
  assert.equal(updates[0].update.$set.role, 'admin');
  assert.deepEqual(updates[1].filter.role.$in, ['admin', 'staff']);
  assert.deepEqual(updates[1].filter.mustChangePassword, { $ne: true });
  assert.equal(updates[1].update.$set.role, 'super_admin');
});

test('migration requires an explicitly confirmed first account and never guesses or replaces an existing owner', () => {
  const first = { _id: admin.id, role: 'admin', active: true, createdAt: '2026-01-01' };
  const next = { _id: staff.id, role: 'staff', active: true, createdAt: '2026-02-01' };
  assert.equal(planFirstSuperAdmin([next, first], first._id), first);
  assert.throws(() => planFirstSuperAdmin([first, next], next._id));
  assert.throws(() => planFirstSuperAdmin([{ ...first, active: false }], first._id));
  assert.throws(() => planFirstSuperAdmin([{ ...first, role: 'super_admin' }], first._id));
  assert.throws(() => planFirstSuperAdmin([{ ...first, createdAt: undefined }], first._id));
});
