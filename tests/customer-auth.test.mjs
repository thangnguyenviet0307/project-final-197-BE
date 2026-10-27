import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { before, after, test } from "node:test";
import argon2 from "argon2";
import { User } from "../dist/models/users.model.js";
import { Customer } from "../dist/models/customers.model.js";
import { generateAccessToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
process.env.FRONTEND_ORIGINS = "http://localhost:5173";
const { default: app } = await import("../dist/app.js");
let server, base;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const input = { email: "shared@example.com", firstName: "Test", lastName: "Customer", password: "Customer123!" };
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Login-Area": "storefront", ...headers }, body: JSON.stringify(body) });
const cookieHeaders = { Origin: "http://localhost:5173", "X-Auth-Transport": "cookie" };
async function fixtures(t) {
  const admin = new User({ ...input, role: "admin", password: await argon2.hash("Admin123!"), active: true, tokenVersion: 0 });
  const customer = new Customer({ ...input, password: await argon2.hash(input.password), accountEnabled: true, isActive: true, tokenVersion: 0 });
  t.mock.method(User, "findOne", filter => ({ select: async () => filter.email === admin.email ? admin : null }));
  t.mock.method(User, "findById", id => ({ select: async () => String(id) === String(admin._id) ? admin : null }));
  t.mock.method(Customer, "findOne", filter => ({ select: async () => filter.email === customer.email ? customer : null }));
  t.mock.method(Customer, "findById", id => ({ select: async () => String(id) === String(customer._id) ? customer : null }));
  const update = record => async (filter, change) => {
    if (filter.password && filter.password !== record.password) return null;
    if (filter.refreshToken && filter.refreshToken !== record.refreshToken) return null;
    Object.assign(record, change.$set); if (change.$inc?.tokenVersion) record.tokenVersion += change.$inc.tokenVersion;
    return record;
  };
  t.mock.method(User, "findOneAndUpdate", update(admin));
  t.mock.method(Customer, "findOneAndUpdate", update(customer));
  t.mock.method(Customer, "findByIdAndUpdate", async (_id, change) => { Object.assign(customer, change.$set); customer.tokenVersion += change.$inc?.tokenVersion ?? 0; return customer; });
  return { admin, customer };
}

test("public registration creates only a Customer with no role or User write and hides credentials", async t => {
  t.mock.method(User, "create", () => assert.fail("Registration must never create User"));
  t.mock.method(User, "exists", () => assert.fail("Administrative email is unrelated"));
  t.mock.method(Customer, "exists", async () => null);
  let saved;
  t.mock.method(Customer, "create", async value => { saved = new Customer(value); return saved; });
  const response = await post("/customer-auth/register", input);
  assert.equal(response.status, 201);
  assert.ok(await argon2.verify(saved.password, input.password));
  assert.equal(saved.accountEnabled, true);
  const data = (await response.json()).data;
  assert.equal(data.accountType, "customer");
  for (const key of ["password", "refreshToken", "tokenVersion", "role"]) assert.equal(data[key], undefined);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("registration rejects invalid/injected fields, duplicates and unique-index races", async t => {
  for (const extra of [{ role: "admin" }, { accountEnabled: true }, { isActive: true }, { tokenVersion: 5 }, { email: "bad" }, { password: "123" }]) {
    assert.equal((await post("/customer-auth/register", { ...input, ...extra })).status, 400);
  }
  t.mock.method(Customer, "exists", async () => ({ _id: "existing" }));
  assert.equal((await post("/customer-auth/register", input)).status, 409);
  t.mock.method(Customer, "exists", async () => null);
  t.mock.method(Customer, "create", async () => { throw { code: 11000 }; });
  assert.equal((await post("/customer-auth/register", input)).status, 409);
});

test("same email chooses separate collections/passwords; tokens cannot cross API boundaries", async t => {
  const { customer } = await fixtures(t);
  const adminLogin = await post("/auth/login", { email: input.email, password: "Admin123!" }, { "X-Login-Area": "admin" });
  assert.equal(adminLogin.status, 200);
  const adminToken = (await adminLogin.json()).data.accessToken;
  const customerLogin = await post("/customer-auth/login", input);
  assert.equal(customerLogin.status, 200);
  const customerToken = (await customerLogin.json()).data.accessToken;
  assert.equal((await post("/auth/login", input, { "X-Login-Area": "admin" })).status, 401);
  assert.equal((await post("/customer-auth/login", { ...input, password: "Admin123!" })).status, 401);
  assert.equal((await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${customerToken}` } })).status, 403);
  assert.equal((await fetch(base + "/customer-auth/me", { headers: { "X-Login-Area": "storefront", Authorization: `Bearer ${adminToken}` } })).status, 403);
  for (const path of ["users", "customers", "orders", "products", "brands", "categories"]) {
    assert.equal((await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${customerToken}` } })).status, 403);
  }
  assert.equal(customer.email, input.email);
});

test("customer profile changes no User and rejects role/email/token injection", async t => {
  const { admin, customer } = await fixtures(t);
  const before = admin.firstName;
  const token = generateAccessToken({ id: String(customer._id), tokenVersion: 0, accountType: "customer" });
  const headers = { "Content-Type": "application/json", "X-Login-Area": "storefront", Authorization: `Bearer ${token}` };
  const profile = { firstName: "Edited", lastName: "Buyer", personalEmail: "", phone: "0901234567", location: "", bio: "" };
  for (const field of [{ role: "admin" }, { email: "other@example.com" }, { accountEnabled: false }, { password: "overwrite" }]) {
    assert.equal((await fetch(base + "/customer-auth/me", { method: "PATCH", headers, body: JSON.stringify({ ...profile, ...field }) })).status, 400);
  }
  const response = await fetch(base + "/customer-auth/me", { method: "PATCH", headers, body: JSON.stringify(profile) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.firstName, "Edited");
  assert.equal(admin.firstName, before);
});

test("customer refresh/logout use only customer cookie and leave admin refresh credentials untouched", async t => {
  const { admin } = await fixtures(t);
  const adminLogin = await post("/auth/login", { email: input.email, password: "Admin123!" }, { ...cookieHeaders, "X-Login-Area": "admin" });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0], adminHash = admin.refreshToken;
  const customerLogin = await post("/customer-auth/login", input, cookieHeaders);
  const cookie = customerLogin.headers.get("set-cookie");
  assert.match(cookie, /^customerRefreshToken=/); assert.match(cookie, /Path=\/api\/v1\/customer-auth/);
  assert.equal((await customerLogin.json()).data.refreshToken, undefined);
  const refreshed = await post("/customer-auth/refresh", {}, { ...cookieHeaders, Cookie: `${cookie.split(";")[0]}; ${adminCookie}` });
  assert.equal(refreshed.status, 200);
  const token = (await refreshed.json()).data.accessToken;
  const logout = await post("/customer-auth/logout", {}, { ...cookieHeaders, Authorization: `Bearer ${token}` });
  assert.equal(logout.status, 200);
  assert.doesNotMatch(logout.headers.get("set-cookie"), /adminRefreshToken/);
  assert.equal(admin.refreshToken, adminHash);
  assert.equal((await post("/auth/refresh", {}, { ...cookieHeaders, "X-Login-Area": "admin", Cookie: adminCookie })).status, 200);
});

test("neither administrative role can create Customer via management or old registration routes", async t => {
  const { admin } = await fixtures(t);
  for (const role of ["admin", "staff"]) {
    admin.role = role;
    const token = generateAccessToken({ id: String(admin._id), tokenVersion: 0 });
    assert.equal((await post("/customers", input, { "X-Login-Area": "admin", Authorization: `Bearer ${token}` })).status, 403);
  }
  assert.equal((await post("/auth/register", input)).status, 410);
});

test("customer profile validates birth dates and gender and preserves account email", async t => {
  const { customer } = await fixtures(t);
  const token = generateAccessToken({ id: String(customer._id), tokenVersion: 0, accountType: "customer" });
  const headers = { "Content-Type": "application/json", "X-Login-Area": "storefront", Authorization: `Bearer ${token}` };
  const profile = { firstName: "Buyer", lastName: "Name", phone: "0901234567", birthDate: "2000-02-29", gender: "female" };
  for (const change of [{ birthDate: "2001-02-29" }, { birthDate: "2999-01-01" }, { gender: "invalid" }, { email: "injected@example.com" }]) {
    assert.equal((await fetch(base + "/customer-auth/me", { method: "PATCH", headers, body: JSON.stringify({ ...profile, ...change }) })).status, 400);
  }
  const response = await fetch(base + "/customer-auth/me", { method: "PATCH", headers, body: JSON.stringify(profile) });
  assert.equal(response.status, 200);
  const saved = (await response.json()).data;
  assert.equal(saved.birthDate, "2000-02-29");
  assert.equal(saved.gender, "female");
  assert.equal(saved.email, input.email);
});

test("shipping address saves without phone or identity document and rejects extra fields", async t => {
  const { customer } = await fixtures(t);
  const token = generateAccessToken({ id: String(customer._id), tokenVersion: 0, accountType: "customer" });
  const headers = { "Content-Type": "application/json", "X-Login-Area": "storefront", Authorization: `Bearer ${token}` };
  const address = { recipientName: "Recipient", email: "recipient@example.com", province: "City", ward: "Ward", street: "123 Road", deliveryTime: "Morning" };
  for (const change of [{ province: "" }, { email: "bad" }, { phone: "0901234567" }, { identityNumber: "123" }, { customerId: String(customer._id) }]) {
    assert.equal((await fetch(base + "/customer-auth/shipping-address", { method: "PATCH", headers, body: JSON.stringify({ ...address, ...change }) })).status, 400);
  }
  const response = await fetch(base + "/customer-auth/shipping-address", { method: "PATCH", headers, body: JSON.stringify(address) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.shippingAddress, address);
});

test("customer orders enforce ownership, pagination, snapshots and response allowlist", async t => {
  const { customer, admin } = await fixtures(t);
  const { Order } = await import("../dist/models/orders.model.js");
  const token = generateAccessToken({ id: String(customer._id), tokenVersion: 0, accountType: "customer" });
  const headers = { "X-Login-Area": "storefront", Authorization: `Bearer ${token}` };
  const checkScope = scope => { assert.deepEqual(Object.keys(scope), ["customerId"]); assert.equal(String(scope.customerId), String(customer._id)); };
  t.mock.method(Order, "find", scope => {
    checkScope(scope);
    return {
      select() { return this; }, sort(value) { assert.deepEqual(value, { orderDate: -1, _id: -1 }); return this; },
      skip(value) { assert.equal(value, 10); return this; }, limit(value) { assert.equal(value, 10); return this; },
      async lean() { return [{ _id: "order", orderCode: "ORD-ABC234", orderStatus: 1, orderDate: "2026-01-01", userId: "private-staff", orderNote: "internal", orderItems: [{ productName: "Snapshot", quantity: 2, price: 100, discount: 10 }] }]; },
    };
  });
  t.mock.method(Order, "countDocuments", async scope => { checkScope(scope); return 11; });
  for (const query of ["?customerId=another", "?page=0", "?limit=100", "?page=bad"]) {
    assert.equal((await fetch(base + "/customer-auth/orders" + query, { headers })).status, 400);
  }
  assert.equal((await fetch(base + "/customer-auth/orders", { headers: { "X-Login-Area": "storefront" } })).status, 401);
  const adminToken = generateAccessToken({ id: String(admin._id), tokenVersion: 0 });
  assert.equal((await fetch(base + "/customer-auth/orders", { headers: { ...headers, Authorization: `Bearer ${adminToken}` } })).status, 403);
  const response = await fetch(base + "/customer-auth/orders?page=2&limit=10", { headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pagination.total, 11);
  assert.equal(result.data[0].totalAmount, 180);
  assert.equal(result.data[0].orderItems[0].productName, "Snapshot");
  assert.equal(result.data[0].userId, undefined);
  assert.equal(result.data[0].orderNote, undefined);
});