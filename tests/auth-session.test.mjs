// Auth/session HTTP and service tests. All database calls are mocked.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { once } from "node:events";
import { before, after, test } from "node:test";
import { User } from "../dist/models/users.model.js";
import { UserService } from "../dist/services/users.service.js";
import { generateAccessToken } from "../dist/utils/token.js";

const requireBackend = createRequire(new URL("../package.json", import.meta.url));
const argon2 = requireBackend("argon2");
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");
let server;
let base;
const password = "CurrentPassword123";
const hash = await argon2.hash(password);
const account = (fields = {}) => new User({
  firstName: "Test", lastName: "User", email: "test@example.com", role: "staff",
  active: true, tokenVersion: 3, password: hash, ...fields,
});
function authenticate(t, user) {
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  return { Authorization: `Bearer ${generateAccessToken({ id: String(user._id), tokenVersion: user.tokenVersion })}` };
}
const post = (path, body, headers) => fetch(base + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });

test("/me returns the database role and password-change flag without credentials", async (t) => {
  const user = account({ mustChangePassword: true });
  const headers = authenticate(t, user);
  const response = await fetch(base + "/api/v1/auth/me", { headers });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.id, String(user._id));
  assert.equal(data.role, "staff");
  assert.equal(data.mustChangePassword, true);
  for (const key of ["password", "refreshToken", "tokenVersion"]) assert.equal(data[key], undefined);
});

test("/me requires authentication", async () => {
  assert.equal((await fetch(base + "/api/v1/auth/me")).status, 401);
});

test("temporary-password accounts cannot access business APIs, even if they are admin", async (t) => {
  const headers = authenticate(t, account({ role: "admin", mustChangePassword: true }));
  assert.equal((await fetch(base + "/api/v1/users", { headers })).status, 403);
});

test("staff cannot create users or reset another user's password", async (t) => {
  const headers = authenticate(t, account());
  assert.equal((await post("/api/v1/users", {}, headers)).status, 403);
  assert.equal((await fetch(base + "/api/v1/users/507f1f77bcf86cd799439011", {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ password: "Temporary123" }),
  })).status, 403);
});

test("password change verifies the old password before touching the database", async (t) => {
  const headers = authenticate(t, account({ mustChangePassword: true }));
  const update = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not write"); });
  const response = await post("/api/v1/auth/change-password", { currentPassword: "incorrect", newPassword: "NewPassword123!" }, headers);
  assert.equal(response.status, 400);
  assert.equal(update.mock.callCount(), 0);
});

test("self-service change hashes the new password, clears the flag, and revokes sessions atomically", async (t) => {
  const user = account({ mustChangePassword: true });
  const headers = authenticate(t, user);
  t.mock.method(User, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter.password, hash);
    assert.equal(filter.$or[0].tokenVersion, 3);
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(update.$set.mustChangePassword, false);
    assert.equal(await argon2.verify(update.$set.password, "NewPassword123!"), true);
    assert.equal(options.runValidators, true);
    return user;
  });
  const response = await post("/api/v1/auth/change-password", { currentPassword: password, newPassword: "NewPassword123!" }, headers);
  assert.equal(response.status, 200);
});

test("self-service change rejects reuse, short passwords, and concurrent account changes", async (t) => {
  const headers = authenticate(t, account());
  for (const newPassword of [password, "short", "abcdef1!", "Abcdef!", "Abcdef1", "Abcd1 "]) {
    assert.equal((await post("/api/v1/auth/change-password", { currentPassword: password, newPassword }, headers)).status, 400);
  }
  t.mock.method(User, "findOneAndUpdate", async () => null);
  assert.equal((await post("/api/v1/auth/change-password", { currentPassword: password, newPassword: "NewPassword123!" }, headers)).status, 409);
});

test("admin resets require the target to change password and revoke its previous sessions", async (t) => {
  const headers = authenticate(t, account({ role: "admin" }));
  const target = account();
  t.mock.method(User, "findOneAndUpdate", async (id, update) => {
    assert.equal(id._id, String(target._id));
    assert.equal(update.$set.mustChangePassword, true);
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(await argon2.verify(update.$set.password, "TemporaryPassword123"), true);
    return target;
  });
  const response = await fetch(base + `/api/v1/users/${target._id}`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ password: "TemporaryPassword123" }),
  });
  assert.equal(response.status, 200);
});

test("new admin-provisioned accounts must change their temporary passwords", async (t) => {
  t.mock.method(User, "exists", async () => null);
  t.mock.method(User, "create", async (input) => {
    assert.equal(input.mustChangePassword, true);
    assert.equal(await argon2.verify(input.password, "TemporaryPassword123"), true);
    return new User(input);
  });
  await UserService.createUser({ firstName: "New", lastName: "Staff", email: "new@example.com", password: "TemporaryPassword123", role: "staff", active: true });
});
