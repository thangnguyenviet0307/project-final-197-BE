import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { checkoutSchema } from '../dist/validations/orders/checkout.validation.js';
import { CheckoutRequest } from '../dist/models/orders/checkout-requests.model.js';
import { checkout } from '../dist/services/orders/checkout.service.js';
import { SystemLock } from '../dist/models/shared/system-locks.model.js';
import { GuestContacts } from '../dist/models/customers/guest-contacts.model.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import Product from '../dist/models/products/products.model.js';
import { Order } from '../dist/models/orders/orders.model.js';
import { BrandModel } from '../dist/models/brands/brands.model.js';
import { Categories } from '../dist/models/categories/categories.model.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';
import app from '../dist/app.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
const customerId = String(new mongoose.Types.ObjectId());
const productId = String(new mongoose.Types.ObjectId());
const input = () =>
  checkoutSchema.parse({
    requestId: randomUUID(),
    recipientName: 'Người nhận',
    phone: '0901234567',
    email: 'guest@example.com',
    addressVersion: 2,
    provinceCode: 1,
    wardCode: 3,
    street: '12 Đường A',
    note: 'Giao buổi sáng',
    paymentMethod: 'cod',
    items: [{ productId, quantity: 2, expectedUnitPrice: 90 }],
  });
const locations = [
  { code: 1, name: 'Province', wards: [{ code: 3, name: 'Ward' }] },
];
function harness(t) {
  const receipts = new Map();
  t.mock.method(CheckoutRequest, 'findOne', (scope) => ({
    select() {
      return this;
    },
    session: async () =>
      receipts.get(`${scope.customerId}:${scope.requestId}`) ?? null,
  }));
  t.mock.method(CheckoutRequest.prototype, 'save', async function () {
    receipts.set(`${this.customerId}:${this.requestId}`, this);
    return this;
  });
  t.mock.method(Customer, 'find', () => ({
    select() {
      return this;
    },
    limit() {
      return this;
    },
    session: async () => [],
  }));
  t.mock.method(GuestContacts, 'find', () => ({
    limit() {
      return this;
    },
    session: async () => [],
  }));
  t.mock.method(
    GuestContacts,
    'findOneAndUpdate',
    async (filter, update) =>
      new GuestContacts({
        _id: filter._id,
        ...update.$setOnInsert,
        ...update.$set,
      })
  );
  const state = { saved: [], aborted: 0, profileSaves: 0 };
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => locations,
  }));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async (callback) => {
    try {
      return await callback({});
    } catch (error) {
      state.aborted++;
      throw error;
    }
  });
  const customer = {
    _id: customerId,
    tokenVersion: 0,
    firstName: 'Tên',
    lastName: 'Họ',
    email: 'customer@example.com',
    phone: '0999999999',
    isModified: () => true,
    save: async () => {
      state.profileSaves++;
    },
  };
  t.mock.method(Customer, 'findOne', () => ({
    select() {
      return this;
    },
    session: async () => customer,
  }));
  for (const model of [BrandModel, Categories])
    t.mock.method(model, 'exists', () => ({
      session() {
        return this;
      },
      then(resolve) {
        return Promise.resolve({}).then(resolve);
      },
    }));
  const product = new Product({
    _id: productId,
    product_name: 'Sản phẩm',
    sku: 'TEST',
    price: 100,
    discount: 10,
    stock: 5,
    is_active: true,
  });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  t.mock.method(product, 'save', async () => product);
  t.mock.method(Order, 'findOne', () => ({
    select() {
      return this;
    },
    session: async () => null,
  }));
  t.mock.method(Order.prototype, 'save', async function () {
    await this.validate();
    state.saved.push(this);
    return this;
  });
  return { state, product, customer };
}
test('checkout rejects caller identity, totals, invalid phone, quantities, payment and duplicate lines', () => {
  const valid = input();
  for (const change of [
    { customerId },
    { userId: customerId },
    { totalAmount: 1 },
    { phone: '123' },
    { paymentMethod: 'card' },
    { wardCode: 0 },
    { items: [] },
    { items: [valid.items[0], valid.items[0]] },
    { items: [{ ...valid.items[0], quantity: 0 }] },
    { items: [{ ...valid.items[0], price: 1 }] },
  ])
    assert.equal(
      checkoutSchema.safeParse({ ...valid, ...change }).success,
      false
    );
});
test('locality requests are coalesced/cached and upstream failures fail closed', async (t) => {
  const fresh =
    await import('../dist/services/orders/checkout-locations.service.js?cache-test');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => locations,
  }));
  const [a, b] = await Promise.all([
    fresh.getCheckoutLocations(),
    fresh.getCheckoutLocations(),
  ]);
  assert.deepEqual(a, b);
  assert.equal(fetchMock.mock.callCount(), 1);
  await assert.rejects(
    fresh.resolveCheckoutAddress({
      addressVersion: 2,
      provinceCode: 1,
      wardCode: 999,
    }),
    { status: 400 }
  );
  assert.equal(fetchMock.mock.callCount(), 1);
  fetchMock.mock.mockImplementation(async () => {
    throw new Error('Offline');
  });
  const offline =
    await import('../dist/services/orders/checkout-locations.service.js?offline-test');
  await assert.rejects(offline.getCheckoutLocations(), { status: 503 });
});
test('checkout creates an unassigned pending COD order and updates saved contact phone', async (t) => {
  const { state, product, customer } = harness(t);
  const result = await checkout(customerId, 0, input());
  assert.equal(result.totalAmount, 180);
  assert.equal(result.orderStatus, 1);
  assert.match(result.orderCode, /^ORD-/);
  assert.equal(product.stock, 3);
  assert.equal(state.saved[0].userId, undefined);
  assert.equal(String(state.saved[0].customerId), customerId);
  assert.equal(state.saved[0].recipientName, 'Người nhận');
  assert.equal(state.saved[0].recipientPhone, '0901234567');
  assert.equal(customer.phone, '0901234567');
  assert.equal(state.saved[0].city, 'Ward');
  assert.equal(state.saved[0].orderItems[0].price, 100);
});
test('replaying the same request returns the original order and reserves stock once; changed payload conflicts', async (t) => {
  const { state, product } = harness(t);
  const request = input();
  const first = await checkout(customerId, 0, request);
  const second = await checkout(customerId, 0, request);
  assert.deepEqual(second, first);
  assert.equal(state.saved.length, 1);
  assert.equal(product.stock, 3);
  await assert.rejects(
    checkout(customerId, 0, { ...request, street: 'Other' }),
    { status: 409 }
  );
});
test('price changes and stock conflicts abort without creating an order', async (t) => {
  const { state, product } = harness(t);
  await assert.rejects(
    checkout(customerId, 0, {
      ...input(),
      items: [{ productId, quantity: 2, expectedUnitPrice: 1 }],
    }),
    { status: 409 }
  );
  product.stock = 1;
  await assert.rejects(checkout(customerId, 0, input()), { status: 409 });
  assert.equal(state.saved.length, 0);
  assert.equal(product.stock, 1);
  assert.equal(state.aborted, 2);
});

test('checkout synchronizes phone and both address representations on new orders only', async (t) => {
  const { customer, state } = harness(t);
  customer.phone = '';
  const request = input();
  await checkout(customerId, 0, request);
  assert.equal(customer.phone, request.phone);
  assert.equal(customer.shippingAddress.street, request.street);
  assert.equal(customer.shippingAddress.district, '');
  assert.equal(customer.shippingAddress.email, customer.email);
  assert.equal(customer.shippingAddress.addressVersion, 2);
  assert.deepEqual(customer.address, {
    street: request.street,
    city: locations[0].wards[0].name,
    state: locations[0].name,
  });
  const originalOrder = state.saved[0];
  await checkout(customerId, 0, request);
  assert.equal(state.profileSaves, 1);
  const saved = { ...customer.shippingAddress };
  state.saved.length = 0;
  await checkout(customerId, 0, {
    ...input(),
    street: 'Different address',
    phone: '0987654321',
  });
  assert.equal(customer.phone, '0987654321');
  assert.equal(customer.shippingAddress.street, 'Different address');
  assert.equal(customer.address.street, 'Different address');
  assert.equal(saved.street, request.street);
  assert.equal(state.profileSaves, 2);
  assert.equal(originalOrder.street, request.street);
  const latestAddress = { ...customer.shippingAddress };
  await checkout(customerId, 0, request);
  assert.deepEqual(customer.shippingAddress, latestAddress);
  assert.equal(state.profileSaves, 2);
});

test('rejected checkout leaves missing profile details untouched', async (t) => {
  const { customer } = harness(t);
  customer.phone = '';
  await assert.rejects(
    checkout(customerId, 0, {
      ...input(),
      items: [{ productId, quantity: 2, expectedUnitPrice: 1 }],
    }),
    { status: 409 }
  );
  assert.equal(customer.phone, '');
  assert.equal(customer.shippingAddress, undefined);
});
test('mismatched address, revoked session, and stopped products cannot create orders', async (t) => {
  const { state, product } = harness(t);
  await assert.rejects(checkout(customerId, 0, { ...input(), wardCode: 999 }), {
    status: 400,
  });
  await assert.rejects(checkout(customerId, 1, input()), { status: 401 });
  product.on_sale = false;
  await assert.rejects(checkout(customerId, 0, input()), { status: 409 });
  assert.equal(state.saved.length, 0);
  assert.equal(product.stock, 5);
});

test('guest checkout creates an order with a CRM contact, without creating or modifying a login account and retries reserve once', async (t) => {
  const { state, product } = harness(t);
  const create = t.mock.method(Customer, 'create', () =>
    assert.fail('Guest checkout must not create an account')
  );
  const request = input();
  const first = await checkout(null, 0, request);
  const replay = await checkout(null, 0, request);
  assert.deepEqual(first, replay);
  assert.equal(state.saved.length, 1);
  assert.equal(product.stock, 3);
  assert.equal(state.saved[0].guestCheckout, true);
  assert.equal(state.saved[0].customerId, null);
  assert.ok(state.saved[0].contactCustomerId);
  assert.equal(GuestContacts.findOneAndUpdate.mock.callCount(), 1);
  assert.equal(state.saved[0].customerSnapshot.email, request.email);
  assert.equal(state.saved[0].customerSnapshot.phone, request.phone);
  assert.equal(Customer.findOne.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(state.profileSaves, 0);
  await assert.rejects(checkout(null, 0, { ...request, phone: '0987654321' }), {
    status: 409,
  });
});

test('guest checkout validates stock, current price and locality before creating an order', async (t) => {
  const { state, product } = harness(t);
  await assert.rejects(checkout(null, 0, { ...input(), wardCode: 999 }), {
    status: 400,
  });
  await assert.rejects(
    checkout(null, 0, {
      ...input(),
      items: [{ productId, quantity: 2, expectedUnitPrice: 1 }],
    }),
    { status: 409 }
  );
  product.stock = 1;
  await assert.rejects(checkout(null, 0, input()), { status: 409 });
  assert.equal(state.saved.length, 0);
  assert.equal(state.profileSaves, 0);
});

test('only guest orders may omit their customer relation and cannot carry an account ID', async () => {
  const fields = {
    street: 'Street',
    city: 'City',
    state: 'Province',
    paymentType: 1,
    orderItems: [{ productId, quantity: 1, price: 10 }],
  };
  await assert.rejects(new Order(fields).validate());
  await new Order({
    ...fields,
    guestCheckout: true,
    customerId: null,
  }).validate();
  await assert.rejects(
    new Order({ ...fields, guestCheckout: true, customerId }).validate()
  );
});

test('public guest endpoint accepts anonymous checkout, rejects injected identity, and limits repeated requests', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const realFetch = globalThis.fetch;
  const { state } = harness(t);
  const url = `http://127.0.0.1:${server.address().port}/api/v1/storefront/checkout`;
  const send = (body) =>
    realFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const request = input();
  const first = await send(request);
  assert.equal(first.status, 201);
  const response = (await first.json()).data;
  assert.deepEqual(Object.keys(response).sort(), [
    '_id',
    'orderCode',
    'orderStatus',
    'totalAmount',
  ]);
  const replay = await send(request);
  assert.equal(replay.status, 201);
  assert.deepEqual((await replay.json()).data, response);
  assert.equal((await send({ ...request, customerId })).status, 400);
  assert.equal((await send({ ...request, guestCheckout: false })).status, 400);
  assert.equal((await send({ ...request, street: 'Changed' })).status, 409);
  const limited = await send(request);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal(state.saved.length, 1);
});
test('customer checkout endpoint rejects anonymous/admin identities and validates authenticated requests', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/customer-auth/orders`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Login-Area': 'storefront',
  };
  const send = (token, body = input()) =>
    fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await send()).status, 401);
  assert.equal(
    (await send(generateAccessToken({ id: customerId, tokenVersion: 0 })))
      .status,
    403
  );
  t.mock.method(Customer, 'findById', () => ({
    select: async () => ({
      _id: customerId,
      isActive: true,
      accountEnabled: true,
      tokenVersion: 0,
    }),
  }));
  assert.equal(
    (
      await send(
        generateAccessToken({
          id: customerId,
          tokenVersion: 0,
          accountType: 'customer',
        }),
        { ...input(), customerId }
      )
    ).status,
    400
  );
});

test('guest receipt survives deleted orders and replay ignores an offline locality provider', async (t) => {
  const { state, product } = harness(t);
  const request = input();
  const first = await checkout(null, 0, request);
  state.saved.length = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Offline');
  });
  const replay = await checkout(null, 0, request);
  assert.deepEqual(replay, first);
  assert.equal(state.saved.length, 0);
  assert.equal(product.stock, 3);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('new guest orders require email but old committed receipts replay without it', async (t) => {
  harness(t);
  const request = input();
  delete request.email;
  await assert.rejects(checkout(null, 0, request), { status: 400 });
  assert.equal(GuestContacts.findOneAndUpdate.mock.callCount(), 0);
  const result = {
    _id: new mongoose.Types.ObjectId(),
    orderCode: 'ORD-ABC234',
    totalAmount: 180,
    orderStatus: 1,
  };
  CheckoutRequest.findOne.mock.mockImplementation(() => ({
    select() {
      return this;
    },
    session: async () => ({
      payloadHash: createHash('sha256')
        .update(JSON.stringify(checkoutSchema.parse(request)))
        .digest('hex'),
      result,
    }),
  }));
  assert.deepEqual(await checkout(null, 0, request), {
    ...result,
    _id: String(result._id),
  });
  assert.equal(GuestContacts.findOneAndUpdate.mock.callCount(), 0);
});
