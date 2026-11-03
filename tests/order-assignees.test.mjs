import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../dist/models/users.model.js';
import { Order } from '../dist/models/orders.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { startOrder, assignOrder, updateOrderStatus } from '../dist/services/orders.services.js';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import app from '../dist/app.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { orderAssigneeScope, listOrderAssignees } from '../dist/services/order-assignees.service.js';
import { orderAssigneesQuerySchema } from '../dist/validations/orders.validation.js';

const actorId = 'a'.repeat(24), otherId = 'b'.repeat(24), orderId = 'c'.repeat(24);
function matches(scope, target) {
  return scope.active === target.active && scope.$or.some(condition => condition._id
    ? String(condition._id) === target.id && condition.role === target.role
    : condition.role.$in.includes(target.role));
}
for (const [role, targetRole, self, allowed] of [
  ['super_admin', 'super_admin', true, true], ['super_admin', 'admin', false, true], ['super_admin', 'staff', false, true],
  ['super_admin', 'super_admin', false, false], ['admin', 'admin', true, true], ['admin', 'staff', false, true],
  ['admin', 'admin', false, false], ['admin', 'super_admin', false, false], ['staff', 'staff', true, true],
]) test(`${role} ${allowed ? 'can' : 'cannot'} start an order for ${self ? 'self' : targetRole}`, async t => {
  const actor = { id: actorId, role };
  const target = { id: self ? actorId : otherId, role: targetRole, active: true };
  assert.equal(matches(orderAssigneeScope(actor), target), allowed);
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  t.mock.method(User, 'exists', filter => {
    assert.equal(filter._id, target.id);
    const result = filter._id === target.id && matches(filter, target) ? { _id: target.id } : null;
    const query = Promise.resolve(result); query.session = () => query; return query;
  });
  t.mock.method(Order, 'countDocuments', () => ({ session: async () => 0 }));
  const write = t.mock.method(Order, 'findOneAndUpdate', async (_filter, update) => ({ orderStatus: 2, userId: update.$set.userId }));
  const action = () => startOrder(actor, orderId, self ? undefined : target.id);
  if (allowed) { const result = await action(); assert.equal(String(result.userId), target.id); }
  else { await assert.rejects(action(), { status: 404 }); assert.equal(write.mock.callCount(), 0); }
});
test('assignment scope rejects inactive targets and unknown roles', () => {
  assert.equal(matches(orderAssigneeScope({ id: actorId, role: 'admin' }), { id: otherId, role: 'staff', active: false }), false);
  assert.throws(() => orderAssigneeScope({ id: actorId, role: 'customer' }), { status: 403 });
});
test('reassignment uses the same hierarchy and cannot write a peer Admin', async t => {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  const order = new Order({ _id: orderId, orderStatus: 2 });
  const save = t.mock.method(order, 'save', async () => order);
  t.mock.method(Order, 'findById', () => ({ session: async () => order }));
  t.mock.method(User, 'exists', filter => {
    assert.equal(matches(filter, { id: otherId, role: 'admin', active: true }), false);
    const query = Promise.resolve(null); query.session = () => query; return query;
  });
  await assert.rejects(assignOrder({ id: actorId, role: 'admin' }, orderId, otherId), { status: 404 });
  assert.equal(save.mock.callCount(), 0);
});
test('assignee list scopes every page and search and exposes only contact/role fields', async t => {
  let filter;
  t.mock.method(User, 'find', value => {
    filter = value;
    const query = { select: fields => { assert.equal(fields, '_id firstName lastName email role'); return query; }, sort: () => query, skip: () => query, limit: () => query, lean: async () => [] }; return query;
  });
  t.mock.method(User, 'countDocuments', async value => { assert.deepEqual(value, filter); return 0; });
  await listOrderAssignees({ id: actorId, role: 'admin' }, { page: 2, limit: 10, search: 'a.*' });
  assert.deepEqual(filter.$and[0], orderAssigneeScope({ id: actorId, role: 'admin' }));
  assert.equal(filter.$and[1].$or[0].firstName.$regex, 'a\\.\\*');
  await assert.rejects(listOrderAssignees({ id: actorId, role: 'staff' }, { page: 1, limit: 10 }), { status: 403 });
});
test('assignee query cannot override roles, active status or pagination bounds', () => {
  for (const value of [{ role: 'super_admin' }, { active: false }, { page: 0 }, { limit: 51 }, { search: 'x'.repeat(101) }]) assert.equal(orderAssigneesQuerySchema.safeParse(value).success, false);
});
test('an unchanged handler is not treated as a new assignment when completing an order', async t => {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  const order = new Order({ _id: orderId, userId: otherId, orderStatus: 2, orderDate: new Date('2026-01-01') });
  t.mock.method(Order, 'findOne', () => ({ session: async () => order }));
  t.mock.method(User, 'exists', filter => {
    assert.deepEqual(filter.role, { $in: ['super_admin', 'admin', 'staff'] });
    assert.equal(filter.$or, undefined);
    const query = Promise.resolve({ _id: otherId }); query.session = () => query; return query;
  });
  t.mock.method(Order, 'findOneAndUpdate', async (_filter, update) => ({ ...order.toObject(), ...update.$set }));
  const result = await updateOrderStatus({ id: actorId, role: 'admin' }, orderId, { orderStatus: 4 });
  assert.equal(String(result.userId), otherId);
  assert.equal(result.orderStatus, 4);
});
test('assignee HTTP endpoint is registered before id routes and rejects Staff/forged filters', async t => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let role = 'admin';
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: actorId, role, active: true, tokenVersion: 0, email: 'actor@example.com', firstName: 'A', lastName: 'B' }) }));
  t.mock.method(User, 'find', () => {
    const query = { select: () => query, sort: () => query, skip: () => query, limit: () => query, lean: async () => [] }; return query;
  });
  t.mock.method(User, 'countDocuments', async () => 0);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/orders/assignees`;
  const headers = { Authorization: `Bearer ${generateAccessToken({ id: actorId, accountType: 'user' })}`, 'X-Login-Area': 'admin' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal((await fetch(`${url}?role=super_admin`, { headers })).status, 400);
  role = 'staff'; assert.equal((await fetch(url, { headers })).status, 403);
  role = 'super_admin'; assert.equal((await fetch(url, { headers })).status, 200);
});
