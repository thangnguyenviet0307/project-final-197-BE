import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Customer } from '../dist/models/customers.model.js';
import { CheckoutRequest } from '../dist/models/checkout-requests.model.js';
import { checkoutSchema } from '../dist/validations/checkout.validation.js';
import { generateAccessToken } from '../dist/utils/token.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/api/v1/customer-auth`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const headers = { 'Content-Type': 'application/json', 'X-Login-Area': 'storefront' };
const input = { requestId: randomUUID(), recipientName: 'Recipient', phone: '0901234567', provinceCode: 1, districtCode: 2, wardCode: 3, street: 'Street', note: '', paymentMethod: 'cod', items: [{ productId: 'a'.repeat(24), quantity: 1, expectedUnitPrice: 100 }] };

test('checkout rejects guests and administrative tokens before customer lookup', async t => {
  const lookup = t.mock.method(Customer, 'findById', () => assert.fail('No customer lookup'));
  const guest = await fetch(base + '/orders', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(guest.status, 401);
  const token = generateAccessToken({ id: 'b'.repeat(24), role: 'admin', tokenVersion: 0 });
  const admin = await fetch(base + '/orders', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  assert.equal(admin.status, 403); assert.equal(lookup.mock.callCount(), 0);
});

test('customer checkout exposes only the receipt result and rejects forged identities', async t => {
  const customer = new Customer({ firstName: 'Customer', lastName: 'Name', email: 'customer@example.com', isActive: true, accountEnabled: true, tokenVersion: 0 });
  t.mock.method(Customer, 'findById', () => ({ select: async () => customer }));
  const result = { _id: 'c'.repeat(24), orderCode: 'ORD-ABC234', totalAmount: 100, orderStatus: 1 };
  t.mock.method(CheckoutRequest, 'findOne', scope => {
    assert.equal(String(scope.customerId), String(customer._id));
    return { select: async () => ({ payloadHash: createHash('sha256').update(JSON.stringify(checkoutSchema.parse(input))).digest('hex'), result }) };
  });
  const token = generateAccessToken({ id: String(customer._id), tokenVersion: 0, accountType: 'customer' });
  const customerHeaders = { ...headers, Authorization: `Bearer ${token}` };
  const response = await fetch(base + '/orders', { method: 'POST', headers: customerHeaders, body: JSON.stringify(input) });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, result);
  const forged = await fetch(base + '/orders', { method: 'POST', headers: customerHeaders, body: JSON.stringify({ ...input, customerId: 'd'.repeat(24) }) });
  assert.equal(forged.status, 400);
});
