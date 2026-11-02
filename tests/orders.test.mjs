import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { SystemLock } from "../dist/models/system-locks.model.js";
import { BrandModel } from "../dist/models/brands.model.js";
import { Categories } from "../dist/models/categories.model.js";
import mongoose from "mongoose";
import { Customer } from "../dist/models/customers.model.js";
import { User } from "../dist/models/users.model.js";
import Product from "../dist/models/products.model.js";
import { Order } from "../dist/models/orders.model.js";
import { createOrder, updateOrderStatus, deleteOrder } from "../dist/services/orders.services.js";
import { createOrderSchema, updateOrderStatusSchema } from "../dist/validations/orders.validation.js";
import productService from "../dist/services/products.service.js";
import { refresh, logout } from "../dist/services/auth.service.js";
import { generateRefreshToken, hashToken } from "../dist/utils/token.js";
import { randomBytes } from "node:crypto";

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const id = () => new mongoose.Types.ObjectId();
const actor = { id: String(id()), role: "admin", tokenVersion: 0 };
const customerId = String(id());
beforeEach((t) => {
  t.mock.method(SystemLock, 'updateOne', async () => ({ acknowledged: true }));
  for (const model of [BrandModel, Categories]) {
    t.mock.method(model, 'exists', () => ({ session() { return this; }, then(resolve) { return Promise.resolve({ _id: id() }).then(resolve); } }));
  }
});
function transactionHarness(t) {
  const session = {};
  const state = { committed: false, aborted: false };
  // Unit-test boundary only: this does not simulate MongoDB rollback or isolation.
  t.mock.method(mongoose.connection, "transaction", async (callback) => {
    try { const result = await callback(session); state.committed = true; return result; }
    catch (error) { state.aborted = true; throw error; }
  });
  t.mock.method(Customer, "findOne", () => ({ session: async (actual) => {
    assert.equal(actual, session); return { _id: customerId, firstName: 'Original', lastName: 'Customer', email: 'original@example.com', phone: '0123456789' };
  } }));
  return { session, state };
}
const input = (items) => ({ customerId, street: "123 Street", city: "City", state: "State", paymentType: 1, orderItems: items });

test('minimum order quantity is enforced before reserving stock, including duplicate lines', async t => {
  transactionHarness(t);
  const product = new Product({ product_name: 'Bulk', sku: 'BULK-001', price: 100, stock: 30, minimumOrderQuantity: 24 });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  const save = t.mock.method(product, 'save', async () => product);
  t.mock.method(Order.prototype, 'save', async function () { return this; });
  const productId = String(product._id);
  await assert.rejects(createOrder(actor, input([{ productId, quantity: 23 }])), { status: 400 });
  assert.equal(product.stock, 30); assert.equal(save.mock.callCount(), 0);
  const order = await createOrder(actor, input([{ productId, quantity: 12 }, { productId, quantity: 12 }]));
  assert.equal(product.stock, 6);
  assert.equal(order.orderItems[0].sku, 'BULK-001');
});

test("order reserves only the selected variant, merges duplicates and snapshots server price", async (t) => {
  const { session, state } = transactionHarness(t);
  const product = new Product({ product_name: "Product", price: 99, discount: 10, stock: 8,
    variants: [{ sku: "SKU-A", variant_name: "Original variant", color: "Black", attributes: { material: "Silicone" }, price: 25, stock: 5 }, { sku: "SKU-B", price: 40, stock: 3 }] });
  const variantId = String(product.variants[0]._id);
  t.mock.method(Product, "findById", () => ({ session: async () => product }));
  t.mock.method(product, "save", async (options) => { assert.equal(options.session, session); return product; });
  t.mock.method(Order.prototype, "save", async function (options) { assert.equal(options.session, session); return this; });
  const order = await createOrder(actor, input([
    { productId: String(product._id), variantId, quantity: 1 },
    { productId: String(product._id), variantId, quantity: 2 },
  ]));
  assert.match(order.orderCode, /^ORD-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(order.orderItems.length, 1);
  assert.equal(order.orderItems[0].price, 25);
  assert.equal(order.orderItems[0].sku, "SKU-A");
  assert.equal(order.orderItems[0].productName, "Product");
  assert.equal(order.orderItems[0].variantName, "Original variant");
  assert.deepEqual(order.orderItems[0].selectedOptions, { material: "Silicone", color: "Black" });
  product.product_name = "Changed name";
  product.variants[0].attributes.material = "Changed material";
  assert.equal(order.orderItems[0].productName, "Product");
  assert.equal(order.orderItems[0].selectedOptions.material, "Silicone");
  assert.equal(order.orderItems[0].quantity, 3);
  assert.equal(product.variants[0].stock, 2);
  assert.equal(product.variants[1].stock, 3);
  assert.equal(product.stock, 5);
  assert.equal(order.totalAmount, 67.5);
  assert.equal(order.customerSnapshot.email, 'original@example.com');
  assert.equal(state.committed, true);
});

test("variant selection is required and insufficient stock aborts the transaction", async (t) => {
  const { state } = transactionHarness(t);
  const product = new Product({ variants: [{ sku: "SKU-A", price: 25, stock: 1 }], stock: 1 });
  t.mock.method(Product, "findById", () => ({ session: async () => product }));
  await assert.rejects(createOrder(actor, input([{ productId: String(product._id), quantity: 1 }])), { status: 400 });
  await assert.rejects(createOrder(actor, input([{ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 2 }])), { status: 409 });
  assert.equal(product.stock, 1);
  assert.equal(state.committed, false);
  assert.equal(state.aborted, true);
});

test("order insert errors propagate through the transaction after stock reservation", async (t) => {
  const { state } = transactionHarness(t);
  const product = new Product({ stock: 5, price: 10 });
  t.mock.method(Product, "findById", () => ({ session: async () => product }));
  t.mock.method(product, "save", async () => product);
  t.mock.method(Order.prototype, "save", async () => { throw new Error("insert failed"); });
  await assert.rejects(createOrder(actor, input([{ productId: String(product._id), quantity: 1 }])), /insert failed/);
  assert.equal(state.committed, false);
  assert.equal(state.aborted, true);
});

test("rejecting an order restores variant stock in the same transaction", async (t) => {
  const { session } = transactionHarness(t);
  const product = new Product({ stock: 2, variants: [{ sku: "SKU-A", price: 10, stock: 2 }] });
  const order = new Order({ orderStatus: 1, orderItems: [{ productId: product._id,
    variantId: product.variants[0]._id, quantity: 3, price: 10, discount: 0 }] });
  t.mock.method(Order, "findOne", () => ({ session: async () => order }));
  t.mock.method(Order, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(filter.orderStatus, 1);
    assert.equal(options.session, session);
    return { ...order.toObject(), ...update.$set };
  });
  t.mock.method(Product, "findById", () => ({ session: async () => product }));
  t.mock.method(product, "save", async (options) => { assert.equal(options.session, session); return product; });
  await updateOrderStatus(actor, String(order._id), { orderStatus: 3, cancellationReason: "Customer request" });
  assert.equal(product.stock, 5);
  assert.equal(product.variants[0].stock, 5);
});

test("restoration failure aborts rejection; rejected/completed orders cannot transition again", async (t) => {
  const { state } = transactionHarness(t);
  const order = new Order({ orderStatus: 1, orderItems: [{ productId: id(), quantity: 1, price: 10 }] });
  t.mock.method(Order, "findOne", () => ({ session: async () => order }));
  t.mock.method(Order, "findOneAndUpdate", async () => order);
  t.mock.method(Product, "findById", () => ({ session: async () => null }));
  await assert.rejects(updateOrderStatus(actor, String(order._id), { orderStatus: 3, cancellationReason: "Customer request" }), { status: 409 });
  assert.equal(state.aborted, true);
  assert.equal(state.committed, false);
  for (const status of [3, 4]) {
    order.orderStatus = status;
    await assert.rejects(updateOrderStatus(actor, String(order._id), { orderStatus: 2 }), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, status === 3 ? /Rejected \(3\)/ : /Completed \(4\)/);
      assert.match(error.message, /Processing \(2\)/);
      assert.match(error.message, /Create a new order/);
      return true;
    });
  }
});

test("staff cannot assign an order to another employee", async (t) => {
  const exists = t.mock.method(User, "exists", async () => { throw new Error("Must not query users"); });
  await assert.rejects(createOrder({ ...actor, role: "staff" }, { ...input([]), userId: String(id()) }), { status: 403 });
  assert.equal(exists.mock.callCount(), 0);
});

test("refresh rotation uses an atomic hash comparison and rejects token reuse", async (t) => {
  const token = generateRefreshToken(actor);
  const user = new User({ _id: actor.id, email: "user@example.com", firstName: "A", lastName: "B",
    refreshToken: hashToken(token), tokenVersion: 0, active: true });
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  let used = false;
  t.mock.method(User, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.refreshToken, hashToken(token));
    assert.equal(filter.tokenVersion, 0);
    assert.notEqual(update.$set.refreshToken, token);
    if (used) return null;
    used = true;
    return user;
  });
  const result = await refresh(token);
  assert.notEqual(result.refreshToken, token);
  await assert.rejects(refresh(token), { status: 409, authCode: "AUTH_REFRESH_CONFLICT" });
});

test("logout clears the refresh token and increments session version", async (t) => {
  t.mock.method(User, "findByIdAndUpdate", async (userId, update) => {
    assert.equal(userId, actor.id);
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$inc.tokenVersion, 1);
  });
  await logout(actor.id);
});

test("product creation aggregates variant stock and price when omitted", async (t) => {
  transactionHarness(t);
  t.mock.method(Product, "exists", async () => null);
  t.mock.method(Product.prototype, "save", async function () {
    assert.equal(this.stock, 7);
    assert.equal(this.price, 15);
    return this;
  });
  await productService.createProduct({ product_name: "Test product", model_year: 2025,
    brand: String(id()), category: String(id()), variants: [
      { sku: "SKU-A", stock: 3, price: 15 }, { sku: "SKU-B", stock: 4, price: 20 },
    ] });
});

test("order validation rejects null dates, blank addresses, invalid payment and empty items", () => {
  const valid = input([{ productId: String(id()), quantity: 1 }]);
  assert.equal(createOrderSchema.safeParse(valid).success, true);
  for (const changes of [{ requireDate: null }, { street: '   ' }, { paymentType: 2 }, { orderItems: [] }]) {
    assert.equal(createOrderSchema.safeParse({ ...valid, ...changes }).success, false);
  }
  assert.equal(updateOrderStatusSchema.safeParse({ orderStatus: 2, shippingDate: null }).success, false);
});

test("model rejects invalid statuses, fractional quantities, negative prices and empty items", async () => {
  const valid = { customerId: id(), street: 'Street', city: 'City', state: 'State', paymentType: 1,
    orderItems: [{ productId: id(), quantity: 1, price: 10, discount: 0 }] };
  await new Order(valid).validate();
  for (const changes of [{ orderStatus: 99 }, { paymentType: 99 }, { orderItems: [] },
    { orderItems: [{ ...valid.orderItems[0], quantity: 1.5 }] },
    { orderItems: [{ ...valid.orderItems[0], price: -1 }] },
    { orderItems: [{ ...valid.orderItems[0], discount: 100 }] }]) {
    await assert.rejects(new Order({ ...valid, ...changes }).validate(), { name: 'ValidationError' });
  }
});

test("deleting a missing order returns 404; a non-rejected order returns 409", async (t) => {
  t.mock.method(Order, 'findOneAndDelete', async () => null);
  let exists = false;
  t.mock.method(Order, 'exists', async () => exists ? { _id: id() } : null);
  await assert.rejects(deleteOrder(String(id())), { status: 404 });
  exists = true;
  await assert.rejects(deleteOrder(String(id())), { status: 409 });
});

test('order code collisions retry the entire transaction and allocate a new code', async t => {
  transactionHarness(t);
  const product = new Product({ product_name: 'Case', price: 100, discount: 0, stock: 10 });
  t.mock.method(Product, 'findById', () => ({ session: async () => new Product(product.toObject()) }));
  t.mock.method(Product.prototype, 'save', async function () { return this; });
  const attempts = [];
  t.mock.method(Order.prototype, 'save', async function () {
    attempts.push(this.orderCode);
    if (attempts.length === 1) throw Object.assign(new Error('duplicate orderCode'), { code: 11000, keyPattern: { orderCode: 1 } });
    return this;
  });
  const result = await createOrder(actor, input([{ productId: String(product._id), quantity: 1 }]));
  assert.equal(attempts.length, 2);
  assert.match(result.orderCode, /^ORD-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(result.orderItems[0].quantity, 1);
});

test('stopped or exhausted products cannot reserve inventory or create an order', async t => {
  transactionHarness(t);
  const product = new Product({ product_name: 'Stopped', price: 100, stock: 5, on_sale: false });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  const save = t.mock.method(product, 'save', async () => product);
  const orderSave = t.mock.method(Order.prototype, 'save', async function () { return this; });
  const request = input([{ productId: String(product._id), quantity: 1 }]);
  await assert.rejects(createOrder(actor, request), { status: 409 });
  assert.equal(product.stock, 5);
  product.on_sale = true; product.stock = 0;
  await assert.rejects(createOrder(actor, request), { status: 409 });
  assert.equal(save.mock.callCount(), 0); assert.equal(orderSave.mock.callCount(), 0);
});
