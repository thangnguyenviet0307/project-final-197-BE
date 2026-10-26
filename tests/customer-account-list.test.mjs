import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { before, after, test } from "node:test";
import { User } from "../dist/models/users.model.js";
import { UserService } from "../dist/services/users.service.js";
import { getCustomerAccounts } from "../dist/services/customers.service.js";
import { generateAccessToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port + "/api/v1";
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test("user list and count exclude registered customers before pagination, with or without search", async t => {
  let seen;
  const query = { sort() { return this; }, skip() { return this; }, limit() { return []; } };
  t.mock.method(User, "find", filter => {
    seen = filter;
    assert.deepEqual(filter.role, { $in: ["admin", "staff"] });
    return query;
  });
  t.mock.method(User, "countDocuments", async filter => { assert.deepEqual(filter, seen); return 0; });
  await UserService.getAllUsers({ page: 1, limit: 10 });
  await UserService.getAllUsers({ page: 2, limit: 10, search: "Test" });
  assert.ok(seen.$and);
});

test("registered account list filters customer role, search and status before pagination; hides secrets", async t => {
  let filter;
  const query = {
    sort(value) { assert.deepEqual(value, { createdAt: -1, _id: -1 }); return this; },
    skip(value) { assert.equal(value, 10); return this; },
    limit(value) { assert.equal(value, 10); return this; },
    select(value) { assert.equal(value, "_id firstName lastName email active createdAt"); return this; },
    lean: async () => [{ _id: "buyer", firstName: "Test", lastName: "Buyer", email: "buyer@example.com", active: true,
      createdAt: new Date(), password: "hidden", refreshToken: "hidden", tokenVersion: 2 }],
  };
  t.mock.method(User, "find", value => { filter = value; return query; });
  t.mock.method(User, "countDocuments", async value => { assert.deepEqual(value, filter); return 11; });
  const result = await getCustomerAccounts({ page: 2, limit: 10, search: "buyer.*", isActive: false });
  assert.equal(filter.role, "customer");
  assert.equal(filter.active, false);
  assert.equal(filter.$or[0].firstName.test("buyerZZ"), false);
  assert.equal(result.pagination.total, 11);
  for (const field of ["password", "refreshToken", "tokenVersion"]) assert.equal(result.data[0][field], undefined);
});

test("account list is protected and admin/staff can read it without customer self-service access", async t => {
  assert.equal((await fetch(base + "/customers/accounts")).status, 401);
  let current;
  t.mock.method(User, "findById", () => ({ select: async () => current }));
  const query = { sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => [] };
  t.mock.method(User, "find", () => query);
  t.mock.method(User, "countDocuments", async () => 0);
  for (const role of ["admin", "staff", "customer"]) {
    current = new User({ email: role + "@example.com", firstName: "Test", lastName: "User", role, active: true, tokenVersion: 0 });
    const headers = { Authorization: "Bearer " + generateAccessToken({ id: String(current._id), tokenVersion: 0 }) };
    const response = await fetch(base + "/customers/accounts", { headers });
    assert.equal(response.status, role === "customer" ? 403 : 200);
    if (role !== "customer") {
      assert.deepEqual((await response.json()).data, []);
      assert.equal((await fetch(base + "/customers/accounts?page=invalid", { headers })).status, 400);
    }
  }
});
