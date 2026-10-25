import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import { User } from "../dist/models/users.model.js";
import { login } from "../dist/services/auth.service.js";
import { hashToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const password = "LegacyPassword123";
const bcryptHash = await bcrypt.hash(password, 10);
const argonHash = await argon2.hash(password);
const account = (fields = {}) => ({
  _id: new mongoose.Types.ObjectId(), email: "legacy@example.com", firstName: "Legacy",
  lastName: "User", role: "admin", password: bcryptHash, ...fields,
});
function findAccount(t, user) {
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
}

test("legacy bcrypt login upgrades the hash and backfills active in one conditional write", async (t) => {
  const user = account(); // Both active and tokenVersion are absent in this legacy document.
  findAccount(t, user);
  let stored;
  const update = t.mock.method(User, "findOneAndUpdate", async (filter, changes, options) => {
    assert.equal(filter.password, bcryptHash);
    assert.deepEqual(filter.$and, [
      { $or: [{ active: true }, { active: { $exists: false } }] },
      { $or: [{ tokenVersion: 0 }, { tokenVersion: { $exists: false } }] },
    ]);
    assert.equal(options.runValidators, true);
    stored = changes.$set;
    assert.equal(stored.active, true);
    assert.equal(stored.tokenVersion, 0);
    assert.match(stored.password, /^\$argon2id\$/);
    assert.equal(await argon2.verify(stored.password, password), true);
    return user;
  });
  const result = await login(user.email, password);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(stored.refreshToken, hashToken(result.refreshToken));
  assert.ok(result.accessToken);
  assert.equal(result.user.password, undefined);
  assert.equal(result.user.refreshToken, undefined);
});

test("Argon2 login backfills missing active without rehashing the password", async (t) => {
  const user = account({ password: argonHash });
  findAccount(t, user);
  const hash = t.mock.method(argon2, "hash", async () => { throw new Error("Do not rehash Argon2"); });
  t.mock.method(User, "findOneAndUpdate", async (_filter, changes) => {
    assert.equal(changes.$set.active, true);
    assert.equal(Object.hasOwn(changes.$set, "password"), false);
    return user;
  });
  await login(user.email, password);
  assert.equal(hash.mock.callCount(), 0);
});

test("wrong passwords never upgrade hashes, backfill active or issue sessions", async (t) => {
  let user = account();
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const update = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not write"); });
  for (const stored of [bcryptHash, argonHash]) {
    user = account({ password: stored });
    await assert.rejects(login(user.email, "wrong-password"), { status: 401 });
  }
  assert.equal(update.mock.callCount(), 0);
});

test("explicitly disabled or null active accounts cannot be reactivated by login", async (t) => {
  let user;
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const update = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not write"); });
  for (const active of [false, null]) {
    user = account({ active });
    await assert.rejects(login(user.email, password), { status: 401 });
  }
  assert.equal(update.mock.callCount(), 0);
});

test("concurrent account changes prevent migration and token issuance", async (t) => {
  const user = account({ active: true, tokenVersion: 7 });
  findAccount(t, user);
  t.mock.method(User, "findOneAndUpdate", async (filter) => {
    // The database must match the old hash, active state and version together.
    assert.equal(filter.password, bcryptHash);
    assert.deepEqual(filter.$and[1].$or[0], { tokenVersion: 7 });
    return null;
  });
  await assert.rejects(login(user.email, password), { status: 401 });
});

test("unknown and corrupt hashes fail authentication instead of causing a 500", async (t) => {
  let user;
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const update = t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("Must not write"); });
  for (const hash of ["not-a-hash", "$2b$10$invalid", "$argon2id$invalid"]) {
    user = account({ password: hash });
    await assert.rejects(login(user.email, password), { status: 401 });
  }
  assert.equal(update.mock.callCount(), 0);
});

test("Mongoose hydration of missing active still uses the legacy-compatible update filter", async (t) => {
  const user = User.hydrate(account());
  assert.equal(user.active, true); // Schema defaults hide the absence on reads.
  findAccount(t, user);
  t.mock.method(User, "findOneAndUpdate", async (filter, changes) => {
    assert.deepEqual(filter.$and[0].$or[1], { active: { $exists: false } });
    assert.equal(changes.$set.active, true);
    return user;
  });
  await login(user.email, password);
});
