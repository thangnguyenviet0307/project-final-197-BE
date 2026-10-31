import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import argon2 from "argon2";
import dotenv from "dotenv";
import { User } from "../dist/models/users.model.js";
import { BrandModel } from "../dist/models/brands.model.js";
import { Categories } from "../dist/models/categories.model.js";
import Product from "../dist/models/products.model.js";
import { Customer } from "../dist/models/customers.model.js";
import { Order } from "../dist/models/orders.model.js";
import { createRestClientProxy } from "../scripts/rest-client-proxy.mjs";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");

test("admin login through the proxy authenticates every API and preserves detail routing", async (t) => {
  const password = "FixturePassword123";
  const admin = new User({ email: "fixture@example.com", password: await argon2.hash(password),
    firstName: "Fixture", lastName: "Admin", role: "admin", active: true, tokenVersion: 0 });
  const entries = {
    User: admin,
    Brand: new BrandModel({ name: "Fixture brand", slug: "fixture-brand" }),
    Categories: new Categories({ name: "Fixture category", slug: "fixture-category" }),
    Product: new Product({ product_name: "Fixture product", slug: "fixture-product", price: 100, stock: 5, discount: 10,
      variants: [{ sku: 'FIXTURE-A', price: 25, stock: 5 }] }),
    Customer: new Customer({ firstName: "Fixture", lastName: "Customer", email: 'fixture@example.com', phone: '0123456789' }),
    Order: new Order({ orderStatus: 1 }),
  };
  const queried = new Set();
  entries.Product.brand = entries.Brand._id;
  entries.Product.category = entries.Categories._id;
  // Real Express routes/controllers/services/middleware, only database execution is mocked.
  t.mock.method(mongoose.Query.prototype, "exec", async function () {
    const model = this.model.modelName;
    if (model === 'SystemLock') return { acknowledged: true };
    queried.add(model);
    if (this.op === "countDocuments") return 1;
    if (this.op === "findOneAndUpdate" && model === "User") {
      Object.assign(admin, this.getUpdate().$set);
      return admin;
    }
    if (this.op === "findOneAndUpdate" && model === "Order") {
      if (entries.Order.orderStatus !== this.getFilter().orderStatus) return null;
      Object.assign(entries.Order, this.getUpdate().$set);
      return entries.Order;
    }
    const entry = entries[model];
    assert.ok(entry, `Unexpected database model ${model}`);
    return this.op === "find" ? [entry] : entry;
  });
  const directory = await mkdtemp(join(tmpdir(), "rest-client-api-"));
  const envPath = join(directory, ".env");
  await writeFile(envPath, Object.entries({
    BRAND_ID: String(entries.Brand._id), CATEGORY_ID: String(entries.Categories._id),
    PRODUCT_ID: String(entries.Product._id), CUSTOMER_ID: String(entries.Customer._id),
    VARIANT_ID: String(entries.Product.variants[0]._id),
    ORDER_ID: String(entries.Order._id),
  }).map(([key, value]) => `${key}=${value}`).join("\n"));
  const backend = app.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const proxy = createRestClientProxy({ targetUrl: `http://127.0.0.1:${backend.address().port}`, envPath });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(async () => {
    for (const server of [proxy, backend]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await unlink(envPath);
    await rmdir(directory);
  });
  const base = `http://127.0.0.1:${proxy.address().port}/api/v1`;
  const login = await fetch(`${base}/auth/login`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email: admin.email, password }) });
  assert.equal(login.status, 200);
  assert.match(await readFile(envPath, "utf8"), /ACCESS_TOKEN=/);
  const saved = dotenv.parse(await readFile(envPath));
  for (const [resource, key, model] of [
    ["brands", "BRAND_ID", "Brand"], ["categories", "CATEGORY_ID", "Categories"],
    ["products", "PRODUCT_ID", "Product"], ["customers", "CUSTOMER_ID", "Customer"], ["orders", "ORDER_ID", "Order"],
  ]) {
    const headers = { "x-rest-client-auth": "primary" };
    const list = await fetch(`${base}/${resource}?page=1&limit=10`, { headers });
    assert.equal(list.status, 200, `${resource} list authentication failed`);
    assert.equal(list.headers.get("x-rest-client-proxy-version"), "4");
    assert.ok(Array.isArray((await list.json()).data));
    // A standard Authorization header also works when the request goes directly
    // to the backend; custom proxy headers alone are not authentication.
    const direct = await fetch(`http://127.0.0.1:${backend.address().port}/api/v1/${resource}?page=1&limit=10`, {
      headers: { authorization: `Bearer ${saved.ACCESS_TOKEN}` },
    });
    assert.equal(direct.status, 200, `${resource} standard Authorization failed`);
    assert.ok(Array.isArray((await direct.json()).data));
    const detail = await fetch(`${base}/${resource}/__${key}__`, { headers });
    assert.equal(detail.status, 200, `${resource} detail authentication failed`);
    const body = await detail.json();
    assert.equal(Array.isArray(body.data), false, `${resource} detail must not call Get All`);
    assert.equal(body.data._id, String(entries[model]._id));
  }
  for (const model of Object.keys(entries)) assert.ok(queried.has(model));

  const session = {};
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback(session));
  t.mock.method(Product.prototype, 'save', async function (options) {
    assert.equal(options.session, session);
    return this;
  });
  t.mock.method(Order.prototype, 'save', async function (options) {
    assert.equal(options.session, session);
    await this.validate();
    entries.Order = this;
    return this;
  });
  const headers = { 'content-type': 'application/json', 'x-rest-client-auth': 'primary' };
  const create = await fetch(`${base}/orders`, { method: 'POST', headers, body: JSON.stringify({
    customerId: '__CUSTOMER_ID__', userId: String(admin._id), street: '123 Street', city: 'City', state: 'State', paymentType: 1,
    orderItems: [{ productId: '__PRODUCT_ID__', variantId: '__VARIANT_ID__', quantity: 2, price: 1 }],
  }) });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.data.orderStatus, 1);
  assert.equal(created.data.orderItems[0].price, 25);
  assert.equal(created.data.totalAmount, 45);
  assert.equal(entries.Product.stock, 3);
  assert.equal(dotenv.parse(await readFile(envPath)).ORDER_ID, created.data._id);
  const updated = await fetch(`${base}/orders/__ORDER_ID__/status`, {
    method: 'PATCH', headers, body: JSON.stringify({ orderStatus: 2 }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.orderStatus, 2);
  const rejected = await fetch(`${base}/orders/__ORDER_ID__/status`, {
    method: 'PATCH', headers, body: JSON.stringify({ orderStatus: 3, cancellationReason: "Customer request" }),
  });
  assert.equal(rejected.status, 200);
  assert.equal(entries.Product.stock, 5);

  const wrong = await fetch(`${base}/orders/create`, { method: 'POST', headers, body: '{}' });
  assert.equal(wrong.status, 405);
  assert.match((await wrong.json()).message, /POST \/api\/v1\/orders/);
  const wrongStatusMethod = await fetch(`${base}/orders/${created.data._id}/status`, { method: 'PUT', headers, body: '{}' });
  assert.equal(wrongStatusMethod.status, 405);
  assert.equal(wrongStatusMethod.headers.get('allow'), 'PATCH');
  const routeProbe = await fetch(`${base}/orders`, { method: 'POST', headers, body: '{}' });
  assert.equal(routeProbe.status, 400); // Correct create route, validation stops all writes.
});
