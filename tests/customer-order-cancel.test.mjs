import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { Order } from '../dist/models/orders.model.js';
import Product from '../dist/models/products.model.js';
import { Customer } from '../dist/models/customers.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { cancelCustomerOrder } from '../dist/services/customer-orders.service.js';
import { cancelCustomerOrderSchema } from '../dist/validations/customer-order-cancel.validation.js';
import { generateAccessToken } from '../dist/utils/token.js';
import app from '../dist/app.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
const customerId = String(new mongoose.Types.ObjectId());
const otherId = String(new mongoose.Types.ObjectId());
function harness(t, status = 1) {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  const customer = { tokenVersion: 0 };
  t.mock.method(Customer, 'findOne', () => ({ select() { return this; }, session: async () => customer }));
  const product = new Product({ product_name: 'Reserved', stock: 3, variants: [{ sku: 'CANCEL', price: 100, stock: 3 }] });
  const order = new Order({ customerId, orderStatus: status, paymentType: 1, street: 'Street', city: 'City', state: 'State', orderItems: [{ productId: product._id, variantId: product.variants[0]._id, quantity: 2, price: 100, discount: 0 }] });
  const lookup = t.mock.method(Order, 'findOne', scope => ({ session: async () => String(scope.customerId) === customerId ? order : null }));
  const update = t.mock.method(Order, 'findOneAndUpdate', async (scope, mutation) => {
    assert.equal(scope.orderStatus, 1);
    assert.equal(String(scope.customerId), customerId);
    order.set(mutation.$set);
    return order;
  });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  const save = t.mock.method(product, 'save', async () => product);
  return { order, product, customer, lookup, update, save };
}
test('customer cancellation transitions own pending order and restores the selected variant only once', async t => {
  const { order, product, update, save } = harness(t);
  const first = await cancelCustomerOrder(customerId, 0, String(order._id), 'Đổi địa chỉ');
  assert.equal(first.orderStatus, 3);
  assert.equal(first.cancelledByCustomer, true);
  assert.equal(order.cancellationReason, 'Đổi địa chỉ');
  assert.equal(product.stock, 5);
  assert.equal(product.variants[0].stock, 5);
  const again = await cancelCustomerOrder(customerId, 0, String(order._id), 'Gửi lại');
  assert.equal(String(again._id), String(first._id));
  assert.equal(update.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
});
test('customer cannot cancel another customer order, revoked sessions or non-pending orders', async t => {
  const { order, customer, update, save } = harness(t);
  await assert.rejects(cancelCustomerOrder(otherId, 0, String(order._id), 'Reason'), { status: 404 });
  customer.tokenVersion = 1;
  await assert.rejects(cancelCustomerOrder(customerId, 0, String(order._id), 'Reason'), { status: 401 });
  customer.tokenVersion = 0;
  for (const status of [2, 3, 4]) {
    order.orderStatus = status;
    await assert.rejects(cancelCustomerOrder(customerId, 0, String(order._id), 'Reason'), { status: 409 });
  }
  assert.equal(update.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
});
test('a lost status race does not restore stock', async t => {
  const { order, save } = harness(t);
  t.mock.method(Order, 'findOneAndUpdate', async () => null);
  await assert.rejects(cancelCustomerOrder(customerId, 0, String(order._id), 'Reason'), { status: 409 });
  assert.equal(save.mock.callCount(), 0);
});
test('cancellation refuses to commit when reserved product cannot be restored', async t => {
  const { order } = harness(t);
  t.mock.method(Product, 'findById', () => ({ session: async () => null }));
  await assert.rejects(cancelCustomerOrder(customerId, 0, String(order._id), 'Reason'), { status: 409 });
});
test('cancel API rejects anonymous/admin identities, invalid IDs, empty reason and forged ownership/status', async t => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/customer-auth/orders`;
  const send = (token, id = customerId, body = { cancellationReason: 'Reason' }) => fetch(`${base}/${id}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Login-Area': 'storefront', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send()).status, 401);
  assert.equal((await send(generateAccessToken({ id: customerId, tokenVersion: 0 }))).status, 403);
  t.mock.method(Customer, 'findById', () => ({ select: async () => ({ _id: customerId, isActive: true, accountEnabled: true, tokenVersion: 0 }) }));
  const token = generateAccessToken({ id: customerId, tokenVersion: 0, accountType: 'customer' });
  assert.equal((await send(token, 'not-an-id')).status, 400);
  for (const body of [{ cancellationReason: ' ' }, { cancellationReason: 'x'.repeat(1001) }, { cancellationReason: 'Reason', customerId: otherId }, { cancellationReason: 'Reason', orderStatus: 3 }]) assert.equal((await send(token, customerId, body)).status, 400);
  assert.deepEqual(cancelCustomerOrderSchema.parse({ cancellationReason: '  Reason  ' }), { cancellationReason: 'Reason' });
});
