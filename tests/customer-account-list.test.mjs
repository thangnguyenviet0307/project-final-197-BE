import assert from "node:assert/strict";
import { test } from "node:test";
import { Customer } from "../dist/models/customers.model.js";
import { User } from "../dist/models/users.model.js";
import { getCustomers } from "../dist/services/customers.service.js";
import { UserService } from "../dist/services/users.service.js";
test("management Customer list reads registered Customers only and explicitly excludes secrets", async t => {
  let seen;
  const query = { sort() { return this; }, skip() { return this; }, limit() { return this; }, select(fields) {
    for (const key of ["password", "refreshToken", "tokenVersion", "accountId"]) assert.ok(fields.includes(`-${key}`));
    return [{ _id: "customer", firstName: "Buyer", email: "buyer@example.com" }];
  } };
  t.mock.method(User, "find", () => assert.fail("Customer list must not read users"));
  t.mock.method(Customer, "find", filter => { seen = filter; return query; });
  t.mock.method(Customer, "countDocuments", async filter => { assert.deepEqual(filter, seen); return 1; });
  const result = await getCustomers({ page: 1, limit: 10, search: "buyer.*", isActive: true });
  assert.equal(seen.accountEnabled, true); assert.equal(seen.isActive, true);
  assert.equal(result.pagination.total, 1);
});
test("User list remains restricted to admin/staff and excludes legacy customer records", async t => {
  let seen;
  t.mock.method(User, "find", filter => { seen = filter; return { sort() { return this; }, skip() { return this; }, limit() { return []; } }; });
  t.mock.method(User, "countDocuments", async () => 0);
  await UserService.getAllUsers({ page: 1, limit: 10 });
  assert.deepEqual(seen.role, { $in: ["admin", "staff"] });
});
test("User detail/update/delete queries cannot target legacy customer documents", async t => {
  t.mock.method(User, "findOne", async filter => { assert.deepEqual(filter.role, { $in: ["admin", "staff"] }); return null; });
  await assert.rejects(UserService.getUserById("a".repeat(24)), { status: 404 });
  t.mock.method(User, "findOneAndUpdate", async filter => { assert.deepEqual(filter.role, { $in: ["admin", "staff"] }); return null; });
  await assert.rejects(UserService.updateUser("a".repeat(24), { firstName: "No" }), { status: 404 });
});
