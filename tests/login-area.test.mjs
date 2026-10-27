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
const password = "Password123";
const hash = await argon2.hash(password);
before(async () => {
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const login = area => fetch(base + "/api/v1/auth/login", { method: "POST", headers: {
  "Content-Type": "application/json", "X-Login-Area": area, "X-Auth-Transport": "cookie", Origin: "http://localhost:5173",
}, body: JSON.stringify({ email: "test@example.com", password }) });

for (const [role, area, allowed] of [
  ["admin", "storefront", false], ["staff", "storefront", false], ["customer", "admin", false],
  ["admin", "admin", true], ["staff", "admin", true], ["customer", "storefront", true],
]) test(role + " login at " + area + (allowed ? " succeeds" : " is rejected before issuing a session"), async t => {
  const user = new User({ email: "test@example.com", firstName: "Test", lastName: "User", password: hash,
    role, active: true, tokenVersion: 0, refreshToken: "existing-session-hash" });
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const write = t.mock.method(User, "findOneAndUpdate", async () => user);
  const response = await login(area);
  const body = await response.json();
  assert.equal(response.status, allowed ? 200 : 401);
  if (allowed) {
    assert.equal(body.data.user.role, role);
    assert.ok(body.data.accessToken);
    assert.equal(write.mock.callCount(), 1);
    assert.ok(response.headers.get("set-cookie"));
  } else {
    assert.equal(body.message, "Tài khoản không tồn tại !");
    assert.equal(body.data, null);
    assert.equal(write.mock.callCount(), 0);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(user.refreshToken, "existing-session-hash");
  }
});

test("invalid login areas are rejected before database access", async t => {
  const lookup = t.mock.method(User, "findOne", () => { throw new Error("Must not access database"); });
  assert.equal((await login("unknown")).status, 400);
  assert.equal(lookup.mock.callCount(), 0);
});
