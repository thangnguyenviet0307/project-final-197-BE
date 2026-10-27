import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { before, after, test } from "node:test";
import argon2 from "argon2";
import { User } from "../dist/models/users.model.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
process.env.FRONTEND_ORIGINS = "http://localhost:5173";
const { default: app } = await import("../dist/app.js");
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port + "/api/v1/auth";
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const post = (route, area, body = {}, extra = {}) => fetch(base + route, { method: "POST", headers: {
  "Content-Type": "application/json", Origin: "http://localhost:5173", "X-Auth-Transport": "cookie", "X-Login-Area": area, ...extra,
}, body: JSON.stringify(body) });

test("admin and customer cookies coexist; refreshing/logout of one area leaves the other logged in", async t => {
  const password = "Password123";
  const hash = await argon2.hash(password);
  const admin = new User({ email: "admin@example.com", firstName: "Admin", lastName: "User", role: "admin", password: hash, active: true, tokenVersion: 0 });
  const customer = new User({ email: "buyer@example.com", firstName: "Buyer", lastName: "User", role: "customer", password: hash, active: true, tokenVersion: 0 });
  const users = [admin, customer];
  const byId = id => users.find(user => String(user._id) === String(id));
  t.mock.method(User, "findOne", filter => ({ select: async () => users.find(user => user.email === filter.email) }));
  t.mock.method(User, "findById", id => ({ select: async () => byId(id) }));
  t.mock.method(User, "findOneAndUpdate", async (filter, update) => {
    const user = byId(filter._id);
    Object.assign(user, update.$set);
    return user;
  });
  t.mock.method(User, "findByIdAndUpdate", async (id, update) => {
    const user = byId(id);
    Object.assign(user, update.$set);
    user.tokenVersion += update.$inc?.tokenVersion ?? 0;
    return user;
  });
  const adminLogin = await post("/login", "admin", { email: admin.email, password });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];
  const adminToken = (await adminLogin.json()).data.accessToken;
  assert.ok(adminCookie.startsWith("adminRefreshToken="));
  const customerLogin = await post("/login", "storefront", { email: customer.email, password });
  assert.equal(customerLogin.status, 200);
  const customerCookie = customerLogin.headers.get("set-cookie").split(";")[0];
  assert.ok(customerCookie.startsWith("customerRefreshToken="));
  const jar = adminCookie + "; " + customerCookie;
  const customerRefresh = await post("/refresh", "storefront", {}, { Cookie: jar });
  assert.equal(customerRefresh.status, 200);
  const nextCustomerCookie = customerRefresh.headers.get("set-cookie").split(";")[0];
  const adminRefresh = await post("/refresh", "admin", {}, { Cookie: jar });
  assert.equal(adminRefresh.status, 200);
  assert.ok(adminRefresh.headers.get("set-cookie").startsWith("adminRefreshToken="));
  const logout = await post("/logout", "admin", {}, { Authorization: "Bearer " + adminToken });
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get("set-cookie").startsWith("adminRefreshToken=;"));
  assert.ok(!logout.headers.get("set-cookie").includes("customerRefreshToken"));
  assert.equal(customer.tokenVersion, 0);
  const stillSignedIn = await post("/refresh", "storefront", {}, { Cookie: nextCustomerCookie });
  assert.equal(stillSignedIn.status, 200);
  assert.equal((await post("/refresh", "admin", {}, { Cookie: nextCustomerCookie })).status, 401);
});

test("area-scoped refresh never falls back to the old shared cookie", async () => {
  const response = await post("/refresh", "storefront", {}, { Cookie: "refreshToken=legacy" });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a customer refresh token cannot be rotated through the admin cookie slot", async t => {
  const { generateTokenPair, hashToken } = await import("../dist/utils/token.js");
  const user = new User({ email: "buyer@example.com", firstName: "Buyer", lastName: "User", role: "customer", active: true, tokenVersion: 0 });
  const pair = generateTokenPair({ id: String(user._id), tokenVersion: 0 });
  user.refreshToken = hashToken(pair.refreshToken);
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  const rotate = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not rotate"); });
  const response = await post("/refresh", "admin", {}, { Cookie: "adminRefreshToken=" + pair.refreshToken });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(rotate.mock.callCount(), 0);
});
