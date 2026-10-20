import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { after, before, test, mock } from "node:test";
import express from "express";
import { z } from "zod";
import { validate } from "../dist/middlewares/validate.middleware.js";
import { errorMiddleware } from "../dist/middlewares/error.middleware.js";
import { getCustomersQuerySchema } from "../dist/validations/customers.validation.js";
import { createUserSchema, updateUserSchema } from "../dist/validations/users.validation.js";
import { createProductSchema } from "../dist/validations/products.validation.js";
import { updateProductSchema } from "../dist/validations/products.validation.js";
import { updateCustomerSchema } from "../dist/validations/customers.validation.js";
import { updateBrandSchema } from "../dist/validations/brands.validation.js";
import { updateCategoriesSchema } from "../dist/validations/categories.validation.js";
import { getOrdersQuerySchema, updateOrderStatusSchema } from "../dist/validations/orders.validation.js";
import jwt from "jsonwebtoken";
import { escapeRegex } from "../dist/utils/search.js";
import { User } from "../dist/models/users.model.js";
import { UserService } from "../dist/services/users.service.js";
import { login } from "../dist/services/auth.service.js";
import argon2 from "argon2";
import { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken } from "../dist/utils/token.js";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
process.env.BOOTSTRAP_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");
let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
const post = (path, body, headers = {}) => fetch(base + path, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("login accepts a flat body, normalizes email, and hides credentials", async (t) => {
  const password = " password ";
  const user = new User({ email: "user@example.com", firstName: "Test", lastName: "User", role: "staff",
    password: await argon2.hash(password), tokenVersion: 0 });
  t.mock.method(User, "findOne", (filter) => {
    assert.equal(filter.email, "user@example.com");
    return { select: async () => user };
  });
  t.mock.method(User, "findOneAndUpdate", async (_filter, update) => {
    assert.match(update.$set.refreshToken, /^[a-f0-9]{64}$/);
    return user;
  });
  const response = await post("/api/v1/auth/login", { email: " USER@example.com ", password });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.statusCode, 200);
  assert.ok(body.data.accessToken);
  assert.equal(body.data.user.password, undefined);
  assert.notEqual(body.data.refreshToken, hashToken(body.data.refreshToken));
});

test("invalid refresh input returns 400 and invalid JWT returns 401", async () => {
  for (const body of [{}, { refreshToken: 42 }, { refreshToken: {} }]) {
    const response = await post("/api/v1/auth/refresh", body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).data, null);
  }
  assert.equal((await post("/api/v1/auth/refresh", { refreshToken: "invalid" })).status, 401);
});

test("bootstrap requires a configured secret before accessing the database", async () => {
  const response = await post("/api/v1/auth/bootstrap", {
    email: "admin@example.com", password: "secret123", firstName: "Admin", lastName: "User",
  });
  assert.equal(response.status, 403);
});

test("Express 5 query validation preserves converted numbers and false", async () => {
  const probe = express();
  probe.get("/", validate({ query: getCustomersQuerySchema }), (req, res) => res.json(req.query));
  probe.use(errorMiddleware);
  const listener = probe.listen(0, "127.0.0.1");
  await once(listener, "listening");
  try {
    const url = `http://127.0.0.1:${listener.address().port}`;
    const response = await fetch(url + "/?page=2&isActive=false");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { page: 2, limit: 10, isActive: false });
    assert.equal((await fetch(url + "/?limit=101")).status, 400);
    assert.equal((await fetch(url + "/?isActive=other")).status, 400);
  } finally { listener.closeAllConnections(); await new Promise((resolve) => listener.close(resolve)); }
});

test("query validation errors, protected endpoints and 404 share a JSON envelope", async () => {
  for (const [path, status] of [["/api/v1/users", 401], ["/missing", 404]]) {
    const response = await fetch(base + path);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.statusCode, status);
    assert.equal(body.data, null);
  }
});

test("category image URLs accept HTTP(S) links and allow clearing an image", () => {
  assert.deepEqual(updateCategoriesSchema.parse({ icon: "https://example.com/headphones.jpg" }), {
    icon: "https://example.com/headphones.jpg",
  });
  assert.deepEqual(updateCategoriesSchema.parse({ icon: "" }), { icon: "" });
  assert.throws(() => updateCategoriesSchema.parse({ icon: "javascript:alert(1)" }));
});

test("revoked access tokens cannot access protected data", async (t) => {
  const actor = { id: "507f1f77bcf86cd799439011", tokenVersion: 0 };
  const token = generateAccessToken(actor);
  t.mock.method(User, "findById", () => ({ select: async () => ({ active: true, tokenVersion: 1 }) }));
  const response = await fetch(base + "/api/v1/users", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 401);
});

test("user serialization strips secrets from JSON and plain objects", () => {
  const user = new User({ email: "a@example.com", password: "secret", refreshToken: "private", tokenVersion: 2 });
  for (const output of [user.toJSON(), user.toObject()]) {
    for (const key of ["password", "refreshToken", "tokenVersion"]) assert.equal(output[key], undefined);
  }
  assert.equal(User.schema.path("refreshToken").options.select, false);
});

test("password change hashes password and revokes existing sessions", async (t) => {
  t.mock.method(User, "findByIdAndUpdate", async (_id, update, options) => {
    assert.ok(await argon2.verify(update.$set.password, "new password"));
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(options.runValidators, true);
    return new User();
  });
  await UserService.updateUser("507f1f77bcf86cd799439011", { password: "new password" });
});

test("refresh tokens are unique even within the same second", () => {
  const user = { id: "507f1f77bcf86cd799439011", tokenVersion: 2 };
  const first = generateRefreshToken(user);
  const second = generateRefreshToken(user);
  assert.notEqual(first, second);
  assert.equal(verifyRefreshToken(first).version, 2);
});

test("user schema rejects empty updates and product defaults allow variant aggregation", () => {
  assert.equal(updateUserSchema.safeParse({}).success, false);
  const user = createUserSchema.parse({ email: "A@example.com", password: " secret ", firstName: "A", lastName: "B" });
  assert.equal(user.password, " secret ");
  assert.equal(user.email, "a@example.com");
  const product = createProductSchema.parse({ product_name: "Test product", model_year: 2025,
    brand: "507f1f77bcf86cd799439011", category: "507f1f77bcf86cd799439012" });
  assert.equal(product.price, undefined);
  assert.equal(product.stock, undefined);
});

test("search treats regex syntax literally", () => {
  const value = "a.*[x](b)+?^${}|\\";
  const regex = new RegExp(escapeRegex(value));
  assert.ok(regex.test(value));
  assert.ok(!regex.test("anything else"));
});

test("partial updates never insert create defaults or reset unrelated fields", () => {
  assert.deepEqual(updateUserSchema.parse({ firstName: "Updated" }), { firstName: "Updated" });
  assert.deepEqual(updateProductSchema.parse({ description: "Updated" }), { description: "Updated" });
  assert.deepEqual(updateCustomerSchema.parse({ firstName: "Updated" }), { firstName: "Updated" });
  assert.equal(updateProductSchema.safeParse({}).success, false);
  assert.deepEqual(updateBrandSchema.parse({ description: "Updated" }), { description: "Updated" });
  assert.deepEqual(updateCategoriesSchema.parse({ description: "Updated" }), { description: "Updated" });
  for (const schema of [updateUserSchema, updateProductSchema, updateCustomerSchema, updateBrandSchema, updateCategoriesSchema]) {
    assert.equal(schema.safeParse({}).success, false);
    assert.equal(schema.safeParse({ unknownField: "must not make an update valid" }).success, false);
  }
});

test("access and refresh tokens retain separate signing keys and expiration policies", () => {
  const user = { id: "507f1f77bcf86cd799439011", tokenVersion: 2 };
  const access = generateAccessToken(user);
  const refresh = generateRefreshToken(user);
  assert.equal(verifyAccessToken(access).version, 2);
  assert.equal(verifyRefreshToken(refresh).version, 2);
  assert.throws(() => verifyAccessToken(refresh), { status: 401 });
  assert.throws(() => verifyRefreshToken(access), { status: 401 });
  const accessClaims = jwt.decode(access);
  const refreshClaims = jwt.decode(refresh);
  assert.equal(accessClaims.exp - accessClaims.iat, 15 * 60);
  assert.equal(refreshClaims.exp - refreshClaims.iat, 7 * 24 * 60 * 60);
});

test("order query and body accept the same status set, including coerced query strings", () => {
  for (const status of [1, 2, 3, 4]) {
    assert.equal(getOrdersQuerySchema.parse({ orderStatus: String(status) }).orderStatus, status);
    assert.equal(updateOrderStatusSchema.parse({ orderStatus: status }).orderStatus, status);
  }
  for (const status of [0, 5, 1.5, -1, 99]) {
    assert.equal(getOrdersQuerySchema.safeParse({ orderStatus: String(status) }).success, false);
    assert.equal(updateOrderStatusSchema.safeParse({ orderStatus: status }).success, false);
  }
});

test("unexpected errors never disclose their internal message", async () => {
  const probe = express();
  probe.get("/", () => { throw new Error("database credentials and internal path"); });
  probe.use(errorMiddleware);
  const listener = probe.listen(0, "127.0.0.1");
  await once(listener, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.message, "Internal server error");
    assert.equal(body.data, null);
  } finally { listener.closeAllConnections(); await new Promise((resolve) => listener.close(resolve)); }
});
