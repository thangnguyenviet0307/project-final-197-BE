import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requirePermission } from '../dist/middlewares/auth.middleware.js';
import { hasPermission } from '../dist/config/rolePermissions.js';
import { Permission } from '../dist/types/permissions.type.js';

const mutations = [Permission.OrderAssign, Permission.OrderDelete, Permission.ProductCreate, Permission.ProductUpdate, Permission.ProductDelete, Permission.CustomerUpdate, Permission.CustomerDelete, Permission.UserView];

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

test('admin and staff can view orders; staff can read all history', () => {
  for (const role of ['admin', 'staff']) {
    assert.equal(checkPermission(role, Permission.OrderView), undefined);
  }
  assert.equal(hasPermission('admin', Permission.OrderViewAll), true);
  assert.equal(hasPermission('staff', Permission.OrderViewAll), true);
});

for (const permission of mutations) {
  test(`staff receives 403 for ${permission}; admin is allowed`, () => {
    assert.equal(checkPermission('staff', permission)?.status, 403);
    assert.equal(checkPermission('admin', permission), undefined);
  });
}
for (const permission of [Permission.OrderCreate, Permission.OrderUpdateStatus, Permission.OrderStart, Permission.OrderNote, Permission.OrderUpdateDates, Permission.ProductInventory, Permission.CustomerView]) {
  test(`staff can use operational permission ${permission}`, () => assert.equal(checkPermission('staff', permission), undefined));
}

test("no administrative role can create customers", () => { for (const role of ["admin", "staff"]) assert.equal(checkPermission(role, "customers:create")?.status, 403); });
