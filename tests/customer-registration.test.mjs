import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { before, after, test } from "node:test";
import argon2 from "argon2";
import mongoose from "mongoose";
import { Customer } from "../dist/models/customers.model.js";
import { User } from "../dist/models/users.model.js";
import { generateAccessToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");
let server, base;
const input = { email: "buyer@example.com", password: "Customer123", firstName: "Test", lastName: "Buyer" };
const post = (route, body) => fetch(base + route, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port + "/api/v1";
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test("registration creates a hashed customer account and permits subsequent login", async t => {
  let saved, contact;
  const transactionSession = {};
  t.mock.method(mongoose.connection, "transaction", async work => work(transactionSession));
  t.mock.method(Customer, "exists", async () => null);
  t.mock.method(Customer, "create", async (values, options) => {
    assert.equal(options.session, transactionSession);
    contact = new Customer(values[0]);
    await contact.validate();
    assert.equal(String(contact.accountId), String(saved._id));
    assert.equal(contact.email, input.email);
    assert.equal(contact.phone, "");
    assert.equal(contact.address.street, "");
    return [contact];
  });
  t.mock.method(User, "exists", async () => null);
  t.mock.method(User, "create", async (values, options) => {
    assert.equal(options.session, transactionSession);
    saved = new User(values[0]);
    await saved.validate();
    assert.equal(saved.role, "customer");
    assert.equal(saved.mustChangePassword, false);
    assert.equal(saved.refreshToken, null);
    assert.equal(await argon2.verify(saved.password, input.password), true);
    return [saved];
  });
  const response = await post("/auth/register", { ...input, email: " BUYER@example.com " });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.email, input.email);
  assert.equal(data.role, "customer");
  assert.ok(contact);
  // The standard contact listing includes the registration; no account-list request is needed.
  const admin = new User({ ...input, role: "admin", active: true, tokenVersion: 0 });
  t.mock.method(User, "findById", () => ({ select: async () => admin }));
  t.mock.method(Customer, "find", () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, select: async () => [contact] }));
  t.mock.method(Customer, "countDocuments", async () => 1);
  const contacts = await fetch(base + "/customers", { headers: { Authorization: "Bearer " + generateAccessToken({ id: String(admin._id), tokenVersion: 0 }) } });
  assert.equal(contacts.status, 200);
  const list = await contacts.json();
  assert.equal(list.data[0].email, input.email);
  assert.equal(list.pagination.total, 1);
  for (const field of ["password", "tokenVersion", "refreshToken", "accessToken"]) assert.equal(data[field], undefined);
  t.mock.method(User, "findOne", () => ({ select: async () => saved }));
  t.mock.method(User, "findOneAndUpdate", async () => saved);
  const login = await post("/auth/login", { email: input.email, password: input.password });
  assert.equal(login.status, 200);
  const session = (await login.json()).data;
  assert.equal(session.user.role, "customer");
  assert.ok(session.accessToken);
});

test("registration rejects invalid credentials and injected privileged fields before writes", async t => {
  const create = t.mock.method(User, "create", async () => { throw new Error("Must not write"); });
  for (const values of [
    { ...input, email: "invalid" }, { ...input, password: "123" },
    { ...input, firstName: " " }, { ...input, lastName: "x".repeat(51) },
    { ...input, role: "admin" }, { ...input, active: false }, { ...input, tokenVersion: 99 },
  ]) assert.equal((await post("/auth/register", values)).status, 400);
  assert.equal(create.mock.callCount(), 0);
});

test("registration reports duplicate email including a concurrent unique-index conflict", async t => {
  t.mock.method(mongoose.connection, "transaction", async work => work({}));
  t.mock.method(Customer, "exists", async () => null);
  t.mock.method(User, "exists", async () => ({ _id: "existing" }));
  assert.equal((await post("/auth/register", input)).status, 409);
  t.mock.method(User, "exists", async () => null);
  t.mock.method(User, "create", async () => { throw { code: 11000, keyPattern: { email: 1 } }; });
  assert.equal((await post("/auth/register", input)).status, 409);
});

test("customers can read their session but cannot access management APIs", async t => {
  const user = new User({ ...input, role: "customer", active: true, tokenVersion: 0 });
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  const headers = { Authorization: "Bearer " + generateAccessToken({ id: String(user._id), tokenVersion: 0 }) };
  const me = await fetch(base + "/auth/me", { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.role, "customer");
  for (const route of ["users", "customers", "orders", "products", "categories", "brands"]) {
    assert.equal((await fetch(base + "/" + route, { headers })).status, 403, route);
  }
});

test("existing contacts are never claimed by matching email", async t => {
  t.mock.method(User, "exists", async () => null);
  t.mock.method(Customer, "exists", async () => ({ _id: "existing-contact" }));
  const create = t.mock.method(User, "create", async () => { throw new Error("Must not write"); });
  assert.equal((await post("/auth/register", input)).status, 409);
  assert.equal(create.mock.callCount(), 0);
});

test("contact insert failure rejects and aborts the registration transaction", async t => {
  let aborted = false;
  const transactionSession = {};
  t.mock.method(User, "exists", async () => null);
  t.mock.method(Customer, "exists", async () => null);
  t.mock.method(mongoose.connection, "transaction", async work => {
    try { return await work(transactionSession); } catch (error) { aborted = true; throw error; }
  });
  t.mock.method(User, "create", async (values, options) => {
    assert.equal(options.session, transactionSession);
    return [new User(values[0])];
  });
  t.mock.method(Customer, "create", async (_values, options) => {
    assert.equal(options.session, transactionSession);
    throw { code: 11000, keyPattern: { email: 1 } };
  });
  assert.equal((await post("/auth/register", input)).status, 409);
  assert.equal(aborted, true);
});
