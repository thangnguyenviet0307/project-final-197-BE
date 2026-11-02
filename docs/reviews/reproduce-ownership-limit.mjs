// Loopback-only route diagnostic; every database/service access is mocked.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import createHttpError from 'http-errors';
import app from '../../dist/app.js';
import { User } from '../../dist/models/users.model.js';
import { UserService } from '../../dist/services/users.service.js';
import { generateAccessToken } from '../../dist/utils/token.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
const account = new User({ email: 'fixture@example.com', firstName: 'Fixture', lastName: 'Owner', password: 'unused', role: 'super_admin', active: true, tokenVersion: 0 });
mock.method(User, 'findById', () => ({ select: async () => ({ ...account.toObject(), tokenVersion: 0 }) }));
const transfer = mock.method(UserService, 'transferOwnership', async () => { throw createHttpError(400, 'Current password is incorrect'); });
const token = generateAccessToken({ id: String(account._id), tokenVersion: 0 });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const statuses = [];
  for (let index = 0; index < 40; index++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/users/transfer-ownership`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: 'b'.repeat(24), currentPassword: 'FixtureIncorrect' }),
    });
    statuses.push(response.status);
    await response.arrayBuffer();
  }
  assert.ok(statuses.slice(0, 5).every(status => status === 400));
  assert.ok(statuses.slice(5).every(status => status === 429));
  assert.equal(transfer.mock.callCount(), 5);
  console.log(JSON.stringify({ requests: 40, reachedPasswordService: transfer.mock.callCount(), throttled: statuses.filter(status => status === 429).length, databaseAccess: false }));
} finally { mock.restoreAll(); await new Promise(resolve => server.close(resolve)); }
