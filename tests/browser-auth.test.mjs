import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { before, after, test } from "node:test";
import argon2 from "argon2";
import { Customer as User } from "../dist/models/customers.model.js";
import { generateTokenPair, hashToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
process.env.FRONTEND_ORIGINS = "http://localhost:5173";
const { default: app } = await import("../dist/app.js");
let server, base;
const headers = { "Content-Type": "application/json", Origin: "http://localhost:5173", "X-Auth-Transport": "cookie", "X-Login-Area": "storefront" };
before(async () => {
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port + "/api/v1/customer-auth";
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test("CORS permits credentialed frontend requests and denies unrelated origins", async () => {
  const response = await fetch(base + "/register", { method: "OPTIONS", headers: {
    Origin: headers.Origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-auth-transport",
  } });
  assert.equal(response.headers.get("access-control-allow-origin"), headers.Origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  const denied = await fetch(base + "/login", { method: "POST", headers: { ...headers, Origin: "https://untrusted.example" }, body: "{}" });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("cookie login hides refresh tokens; refresh rotates cookies and logout expires them", async t => {
  const user = new User({ email: "buyer@example.com", password: await argon2.hash("Customer123"),
    firstName: "Test", lastName: "Buyer", accountEnabled: true, isActive: true, tokenVersion: 0 });
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  t.mock.method(User, "findOneAndUpdate", async () => user);
  const login = await fetch(base + "/login", { method: "POST", headers, body: JSON.stringify({ email: user.email, password: "Customer123" }) });
  assert.equal(login.status, 200);
  const data = (await login.json()).data;
  assert.ok(data.accessToken);
  assert.equal(data.refreshToken, undefined);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/v1\/customer-auth/i);
  const pair = generateTokenPair({ id: String(user._id), tokenVersion: 0, accountType: "customer" });
  user.refreshToken = hashToken(pair.refreshToken);
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  const refreshed = await fetch(base + "/refresh", { method: "POST", headers: { ...headers, Cookie: "customerRefreshToken=" + pair.refreshToken }, body: "{}" });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).data.refreshToken, undefined);
  assert.ok(refreshed.headers.get("set-cookie"));
  t.mock.method(User, "findByIdAndUpdate", async () => user);
  const logout = await fetch(base + "/logout", { method: "POST", headers: { ...headers, Authorization: "Bearer " + data.accessToken }, body: "{}" });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /customerRefreshToken=;/);
});

test("cookie refresh requires both a trusted origin and a refresh cookie", async () => {
  assert.equal((await fetch(base + "/refresh", { method: "POST", headers, body: "{}" })).status, 401);
  const { Origin: _origin, ...withoutOrigin } = headers;
  assert.equal((await fetch(base + "/refresh", { method: "POST", headers: withoutOrigin, body: "{}" })).status, 403);
});

test("production cookies support cross-site auth and clear with matching attributes", async t => {
  const { authResponse, clearRefreshCookie } = await import("../dist/utils/auth-cookie.js");
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  });
  for (const area of ["admin", "storefront"]) {
    let issued, cleared;
    const res = {
      setHeader() {},
      cookie(name, value, options) { issued = { name, value, options }; },
      clearCookie(name, options) { cleared = { name, options }; },
    };
    const req = { get: name => ({ "X-Auth-Transport": "cookie", "X-Login-Area": area })[name] };
    const result = authResponse(req, res, { accessToken: "test-access", refreshToken: "test-refresh" });
    assert.equal(result.refreshToken, undefined);
    assert.equal(issued.options.sameSite, "none");
    assert.equal(issued.options.secure, true);
    assert.equal(issued.options.httpOnly, true);
    clearRefreshCookie(res, area);
    assert.equal(cleared.name, issued.name);
    assert.deepEqual(cleared.options, issued.options);
  }
  const denied = await fetch(base + "/refresh", {
    method: "POST", headers: { ...headers, Origin: "https://untrusted.example", Cookie: "customerRefreshToken=test" }, body: "{}",
  });
  assert.equal(denied.status, 403);
});
