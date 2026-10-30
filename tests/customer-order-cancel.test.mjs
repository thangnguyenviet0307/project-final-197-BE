import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { Order } from '../dist/models/orders.model.js';
import Product from '../dist/models/products.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { cancelCustomerOrder } from '../dist/services/customer-orders.service.js';
import { updateOrderStatus } from '../dist/services/orders.services.js';
import { cancelCustomerOrderSchema } from '../dist/validations/orders.validation.js';

const id = () => String(new mongoose.Types.ObjectId());
test('cancellation requires a reason for customers and admin', async () => {
  for (const cancellationReason of ['', ' ', 'x'.repeat(1001)]) {
    assert.equal(cancelCustomerOrderSchema.safeParse({ cancellationReason }).success, false);
  }
  assert.equal(cancelCustomerOrderSchema.safeParse({ cancellationReason: 'Reason', customerId: id() }).success, false);
  await assert.rejects(updateOrderStatus({ id: id(), role: 'admin' }, id(), { orderStatus: 3 }), { status: 400 });
});

test('customer cancellation scopes reads and writes, restores stock once and refuses final orders', async t => {
  const customerId = id(), orderId = id();
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', callback => callback(session));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  let status = 2;
  t.mock.method(Order, 'findOne', scope => {
    assert.equal(String(scope.customerId), customerId);
    return { session: async () => ({ orderStatus: status, orderItems: [{ productId: id(), quantity: 2 }] }) };
  });
  t.mock.method(Order, 'findOneAndUpdate', async (scope, update) => {
    assert.equal(String(scope.customerId), customerId);
    assert.equal(scope.orderStatus, 2);
    assert.equal(update.$set.cancellationReason, 'Changed my mind');
    status = update.$set.orderStatus;
    return {};
  });
  const product = { stock: 3, variants: [], save: async () => {} };
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  await cancelCustomerOrder(customerId, orderId, ' Changed my mind ');
  assert.equal(product.stock, 5);
  await assert.rejects(cancelCustomerOrder(customerId, orderId, 'Again'), { status: 409 });
  assert.equal(product.stock, 5);
});

test('missing or another customer order returns 404 without writing', async t => {
  t.mock.method(mongoose.connection, 'transaction', callback => callback({}));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(Order, 'findOne', () => ({ session: async () => null }));
  const write = t.mock.method(Order, 'findOneAndUpdate', async () => { throw Error('Unexpected write'); });
  await assert.rejects(cancelCustomerOrder(id(), id(), 'Reason'), { status: 404 });
  assert.equal(write.mock.callCount(), 0);
});
