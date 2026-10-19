import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requirePermission } from '../dist/middlewares/auth.middleware.js';
import { hasPermission } from '../dist/config/rolePermissions.js';
import { Permission } from '../dist/types/permissions.type.js';

const mutations = [Permission.OrderCreate, Permission.OrderUpdateStatus, Permission.OrderAssign, Permission.OrderDelete];

function checkPermission(role, permission) {
  let called = false;
  let failure;
  requirePermission(permission)({ user: { id: 'test-user', role } }, {}, (error) => {
    called = true;
    failure = error;
  });
  assert.equal(called, true);
  return failure;
}

test('admin and staff can view orders; staff retains its restricted data scope', () => {
  for (const role of ['admin', 'staff']) {
    assert.equal(checkPermission(role, Permission.OrderView), undefined);
  }
  assert.equal(hasPermission('admin', Permission.OrderViewAll), true);
  assert.equal(hasPermission('staff', Permission.OrderViewAll), false);
});

for (const permission of mutations) {
  test(`staff receives 403 for ${permission}; admin is allowed`, () => {
    assert.equal(checkPermission('staff', permission)?.status, 403);
    assert.equal(checkPermission('admin', permission), undefined);
  });
}