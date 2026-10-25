import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { before, after, test } from "node:test";
import { User } from "../dist/models/users.model.js";
import { generateAccessToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");
let server, base;
const input = { firstName: "Updated", lastName: "Staff", personalEmail: "private@example.com", phone: "0123456", location: "HCM", bio: "Profile" };
const account = () => new User({ firstName: "Test", lastName: "Staff", email: "account@example.com", role: "staff", active: true, tokenVersion: 3 });
function authenticate(t, user) {
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  return { Authorization: `Bearer ${generateAccessToken({ id: String(user._id), tokenVersion: 3 })}` };
}
function patch(body, headers) {
  return fetch(base + "/api/v1/auth/me", { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function photoBody(blob) {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) body.append(key, value);
  body.append("avatar", blob, "avatar.png");
  return body;
}
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });

test("staff can update their own profile without changing credentials or revoking the session", async (t) => {
  const user = account();
  const headers = authenticate(t, user);
  t.mock.method(User, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter._id, String(user._id));
    assert.equal(filter.$or[0].tokenVersion, 3);
    assert.equal(filter.active, true);
    assert.deepEqual(update.$set, input);
    assert.equal(update.$inc, undefined);
    assert.equal(options.new, true);
    assert.equal(options.runValidators, true);
    return new User({ ...user.toObject(), ...input });
  });
  const response = await patch(input, headers);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.email, "account@example.com");
  assert.equal(data.role, "staff");
  assert.equal(data.personalEmail, input.personalEmail);
  assert.equal(data.firstName, "Updated");
  assert.equal(data.phone, input.phone);
  for (const field of ["password", "refreshToken", "tokenVersion"]) assert.equal(data[field], undefined);
});

test("self profile rejects role, account email, password, active state, and target ID changes", async (t) => {
  const headers = authenticate(t, account());
  const update = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not write"); });
  for (const extra of [{ role: "admin" }, { email: "other@example.com" }, { password: "NewPassword123" }, { active: false }, { id: "other" }]) {
    assert.equal((await patch({ ...input, ...extra }, headers)).status, 400);
  }
  assert.equal(update.mock.callCount(), 0);
});

test("profile updates require authentication and validate contact fields", async (t) => {
  assert.equal((await patch(input)).status, 401);
  const headers = authenticate(t, account());
  for (const extra of [{ personalEmail: "invalid" }, { firstName: "" }, { bio: "x".repeat(1001) }]) {
    assert.equal((await patch({ ...input, ...extra }, headers)).status, 400);
  }
});

test("multipart avatar upload is persisted and returned by /me after reloading", async (t) => {
  let user = account();
  const headers = authenticate(t, user);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  t.mock.method(User, "findOneAndUpdate", async (_filter, update) => {
    assert.equal(update.$set.avatar, `data:image/png;base64,${png.toString("base64")}`);
    Object.assign(user, update.$set);
    return user;
  });
  const response = await fetch(base + "/api/v1/auth/me", {
    method: "PATCH", headers, body: photoBody(new Blob([png], { type: "image/png" })),
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).data;
  const reloaded = await fetch(base + "/api/v1/auth/me", { headers });
  assert.equal((await reloaded.json()).data.avatar, saved.avatar);
  assert.equal(saved.personalEmail, input.personalEmail);
});

test("avatar validation rejects oversized files, SVG, and forged PNG content before writing", async (t) => {
  const headers = authenticate(t, account());
  const update = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not write"); });
  for (const [blob, status] of [
    [new Blob([new Uint8Array(800 * 1024 + 1)], { type: "image/png" }), 413],
    [new Blob(["<svg></svg>"], { type: "image/svg+xml" }), 415],
    [new Blob(["not an image"], { type: "image/png" }), 400],
  ]) {
    const response = await fetch(base + "/api/v1/auth/me", { method: "PATCH", headers, body: photoBody(blob) });
    assert.equal(response.status, status);
  }
  assert.equal(update.mock.callCount(), 0);
});

test("resetting an avatar removes the saved image without changing other account fields", async (t) => {
  const user = account();
  const headers = authenticate(t, user);
  t.mock.method(User, "findOneAndUpdate", async (_filter, update) => {
    assert.equal(update.$set.avatar, "");
    assert.equal(update.$set.email, undefined);
    assert.equal(update.$set.role, undefined);
    return user;
  });
  assert.equal((await patch({ ...input, avatar: "" }, headers)).status, 200);
});

test("revoked sessions cannot write profile changes", async (t) => {
  const headers = authenticate(t, account());
  t.mock.method(User, "findOneAndUpdate", async () => null);
  assert.equal((await patch(input, headers)).status, 401);
});
