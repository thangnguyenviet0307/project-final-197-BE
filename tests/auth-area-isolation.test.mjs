import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { User } from '../dist/models/users/users.model.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import { authenticate } from '../dist/middlewares/auth/auth.middleware.js';
import { authenticateCustomer } from '../dist/middlewares/customers/customer-auth.middleware.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const id = 'a'.repeat(24);
test('customer token cannot reach any administrative User lookup even if IDs collide', async (t) => {
  t.mock.method(User, 'findById', () =>
    assert.fail('No cross-type User query')
  );
  const request = {
    headers: {
      authorization: `Bearer ${generateAccessToken({ id, tokenVersion: 0, accountType: 'customer' })}`,
    },
  };
  let failure;
  await authenticate(request, {}, (error) => {
    failure = error;
  });
  assert.equal(failure.status, 403);
});
test('administrative token cannot reach any Customer lookup even if IDs collide', async (t) => {
  t.mock.method(Customer, 'findById', () =>
    assert.fail('No cross-type Customer query')
  );
  const request = {
    headers: {
      authorization: `Bearer ${generateAccessToken({ id, tokenVersion: 0 })}`,
    },
  };
  let failure;
  await authenticateCustomer(request, {}, (error) => {
    failure = error;
  });
  assert.equal(failure.status, 403);
});
