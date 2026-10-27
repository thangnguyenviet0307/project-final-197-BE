import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { before, after, test } from "node:test";
import { User } from "../dist/models/users.model.js";
import Product from "../dist/models/products.model.js";
import { Order } from "../dist/models/orders.model.js";
import { generateAccessToken } from "../dist/utils/token.js";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const { default: app } = await import("../dist/app.js");
let server, base;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = "http://127.0.0.1:" + server.address().port + "/api/v1"; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
function session(t, role) {
  const user = new User({ email: "test@example.com", firstName: "Test", lastName: "User", role, active: true, tokenVersion: 0 });
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  return { user, headers: { Authorization: "Bearer " + generateAccessToken({ id: String(user._id), tokenVersion: 0 }) } };
}

test("named statistics endpoints require authentication, not public ObjectId parsing", async () => {
  for (const endpoint of ["/products/statistics", "/orders/personal-sales"]) assert.equal((await fetch(base + endpoint)).status, 401);
});

for (const role of ["admin", "staff"]) test(role + " reads product statistics without treating statistics as an id", async t => {
  const { headers } = session(t, role);
  t.mock.method(Product, "aggregate", async pipeline => {
    assert.equal(pipeline[0].$group.total.$sum, 1);
    assert.deepEqual(pipeline[0].$group.active.$sum.$cond[0], { $eq: ["$is_active", true] });
    return [{ total: 12, active: 9, outOfStock: 2, stockUnits: 80 }];
  });
  const response = await fetch(base + "/products/statistics", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { total: 12, active: 9, outOfStock: 2, stockUnits: 80 });
  assert.equal((await fetch(base + "/products/not-an-id", { headers })).status, 400);
});

test("empty catalogs return zero statistics", async t => {
  const { headers } = session(t, "admin");
  t.mock.method(Product, "aggregate", async () => []);
  const response = await fetch(base + "/products/statistics", { headers });
  assert.deepEqual((await response.json()).data, { total: 0, active: 0, outOfStock: 0, stockUnits: 0 });
});

test("personal sales are scoped to the authenticated handler and completed orders", async t => {
  const { headers, user } = session(t, "staff");
  t.mock.method(Order, "find", filter => {
    assert.equal(String(filter.userId), String(user._id));
    assert.equal(filter.orderStatus, 4);
    return { select(value) { assert.equal(value, "orderItems"); return this; }, cursor: async function* () {
      yield { orderItems: [{ price: 100, discount: 10, quantity: 2 }] };
      yield { orderItems: [{ price: 0.1, discount: 0, quantity: 3 }] };
    } };
  });
  const response = await fetch(base + "/orders/personal-sales?userId=someone-else", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { completedOrders: 2, revenue: 180.3 });
});

test("customers cannot access internal statistics", async t => {
  const { headers } = session(t, "customer");
  for (const endpoint of ["/products/statistics", "/orders/personal-sales"]) assert.equal((await fetch(base + endpoint, { headers })).status, 403);
});
