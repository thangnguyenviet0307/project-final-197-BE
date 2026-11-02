import assert from "node:assert/strict";
import { test } from "node:test";
import { Customer } from "../dist/models/customers.model.js";
import { User } from "../dist/models/users.model.js";
import { getCustomers } from "../dist/services/customers.service.js";
import { UserService } from "../dist/services/users.service.js";
test("management list combines accounts and guest CRM with an explicit safe projection", async t => {
  t.mock.method(User, "find", () => assert.fail("Customer list must not read users"));
  t.mock.method(Customer, "aggregate", async pipeline => {
    assert.deepEqual(pipeline[0], { $match: { accountEnabled: true } });
    assert.equal(pipeline[2].$unionWith.coll, "guest_contacts");
    const projection = pipeline.find(stage => stage.$project).$project;
    for (const key of ["password", "refreshToken", "tokenVersion", "accountId", "phoneKey"]) assert.equal(projection[key], undefined);
    assert.equal(pipeline.find(stage => stage.$match?.isActive).$match.isActive, true);
    return [{ data: [{ _id: "guest", customerType: "guest" }], total: [{ count: 1 }] }];
  });
  const result = await getCustomers({ page: 1, limit: 10, search: "buyer.*", isActive: true });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].customerType, "guest");
});

test("User list remains restricted to admin/staff and excludes legacy customer records", async t => {
  let seen;
  t.mock.method(User, "find", filter => { seen = filter; return { sort() { return this; }, skip() { return this; }, limit() { return []; } }; });
  t.mock.method(User, "countDocuments", async () => 0);
  await UserService.getAllUsers({ page: 1, limit: 10 });
  assert.deepEqual(seen.role, { $in: ["super_admin", "admin", "staff"] });
});
test("User detail/update/delete queries cannot target legacy customer documents", async t => {
  t.mock.method(User, "findOne", async filter => { assert.deepEqual(filter.role, { $in: ["super_admin", "admin", "staff"] }); return null; });
  await assert.rejects(UserService.getUserById("a".repeat(24)), { status: 404 });
  t.mock.method(User, "findOneAndUpdate", async filter => { assert.deepEqual(filter.role, { $in: ["admin", "staff"] }); return null; });
  await assert.rejects(UserService.updateUser("a".repeat(24), { firstName: "No" }, { id: 'f'.repeat(24), role: 'super_admin' }), { status: 404 });
});
