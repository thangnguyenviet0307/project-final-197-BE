import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import createHttpError from 'http-errors';
import app from '../dist/app.js';
import { User } from '../dist/models/users.model.js';
import { UserService } from '../dist/services/users.service.js';
import { generateAccessToken } from '../dist/utils/token.js';

test('ownership transfer throttles before password verification, isolates actors and recovers after the window', async t => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const accounts = new Map(['a', 'b', 'c'].map(letter => {
    const user = new User({ _id: letter.repeat(24), email: `${letter}@example.com`, firstName: 'Fixture', lastName: 'Account', password: 'unused', role: letter === 'c' ? 'admin' : 'super_admin', active: true, tokenVersion: 0 });
    return [String(user._id), { ...user.toObject(), tokenVersion: 0 }];
  }));
  t.mock.method(User, 'findById', id => ({ select: async () => accounts.get(id) }));
  const verify = t.mock.method(UserService, 'transferOwnership', async () => { throw createHttpError(400, 'Current password is incorrect'); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = async id => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/users/transfer-ownership`, {
      method: 'POST', headers: { ...(id ? { Authorization: `Bearer ${generateAccessToken({ id, tokenVersion: 0 })}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: 'd'.repeat(24), currentPassword: 'WrongFixture' }),
    });
    await response.arrayBuffer();
    return response;
  };
  try {
    assert.equal((await request(null)).status, 401);
    assert.equal((await request('c'.repeat(24))).status, 403);
    for (let index = 0; index < 5; index++) assert.equal((await request('a'.repeat(24))).status, 400);
    const denied = await request('a'.repeat(24));
    assert.equal(denied.status, 429);
    assert.equal(Number(denied.headers.get('Retry-After')), 900);
    assert.equal(verify.mock.callCount(), 5);
    assert.equal((await request('b'.repeat(24))).status, 400);
    assert.equal(verify.mock.callCount(), 6);
    now += 15 * 60 * 1000 + 1;
    assert.equal((await request('a'.repeat(24))).status, 400);
    assert.equal(verify.mock.callCount(), 7);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
