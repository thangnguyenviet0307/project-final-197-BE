import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { User } from '../dist/models/users/users.model.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';
import {
  isBusinessChange,
  subscribeToDataChanges,
} from '../dist/services/data-sync/data-sync.service.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');
const change = (collection, fields) => ({
  operationType: 'update',
  ns: { coll: collection },
  updateDescription: { updatedFields: fields },
});

test('business changes include external catalog writes but exclude auth rotation, views and internal queues', () => {
  assert.equal(
    isBusinessChange({ operationType: 'insert', ns: { coll: 'categories' } }),
    true
  );
  assert.equal(
    isBusinessChange({ operationType: 'delete', ns: { coll: 'products' } }),
    true
  );
  assert.equal(
    isBusinessChange(change('products', { name: 'New name' })),
    true
  );
  assert.equal(
    isBusinessChange({
      operationType: 'update',
      ns: { coll: 'products' },
      updateDescription: { truncatedArrays: [{ field: 'images', newSize: 0 }] },
    }),
    true
  );
  assert.equal(
    isBusinessChange(
      change('users', {
        refreshToken: 'secret',
        tokenVersion: 4,
        updatedAt: new Date(),
      })
    ),
    false
  );
  assert.equal(
    isBusinessChange(change('posts', { viewCount: 3, updatedAt: new Date() })),
    false
  );
  assert.equal(
    isBusinessChange({
      operationType: 'insert',
      ns: { coll: 'customer_otp_jobs' },
    }),
    false
  );
  assert.equal(isBusinessChange({ operationType: 'invalidate' }), false);
});

test('subscribers share one stream, receive only business signals and recover after stream failure', (t) => {
  const source = new EventEmitter();
  source.close = t.mock.fn(async () => {});
  const watch = t.mock.method(mongoose.connection, 'watch', () => source);
  const first = t.mock.fn();
  const second = t.mock.fn();
  const failed = t.mock.fn();
  const stopFirst = subscribeToDataChanges(first, failed);
  const stopSecond = subscribeToDataChanges(second, failed);
  assert.equal(watch.mock.callCount(), 1);
  source.emit('change', change('users', { refreshToken: 'secret' }));
  assert.equal(first.mock.callCount(), 0);
  source.emit('change', change('products', { name: 'New name' }));
  assert.deepEqual(first.mock.calls[0].arguments, []);
  assert.equal(second.mock.callCount(), 1);
  stopFirst();
  assert.equal(source.close.mock.callCount(), 0);
  source.emit('error', new Error('Disconnected'));
  assert.equal(failed.mock.callCount(), 1);
  assert.equal(source.close.mock.callCount(), 1);
  stopSecond();
  const stopNext = subscribeToDataChanges(first, failed);
  assert.equal(watch.mock.callCount(), 2);
  stopNext();
  assert.equal(source.close.mock.callCount(), 2);
});

test('SSE rejects anonymous/customers and sends authenticated admins only a generic change signal', async (t) => {
  const source = new EventEmitter();
  source.close = async () => {};
  t.mock.method(mongoose.connection, 'watch', () => source);
  const user = new User({
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'Admin',
    role: 'staff',
    active: true,
    tokenVersion: 0,
  });
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/v1/data-sync/events`;
  const controller = new AbortController();
  try {
    assert.equal((await fetch(url)).status, 401);
    const customerToken = generateAccessToken({
      id: String(user._id),
      accountType: 'customer',
      tokenVersion: 0,
    });
    assert.equal(
      (
        await fetch(url, {
          headers: { Authorization: `Bearer ${customerToken}` },
        })
      ).status,
      403
    );
    const token = generateAccessToken({
      id: String(user._id),
      tokenVersion: 0,
    });
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      'data: changed\n\n'
    );
    source.emit(
      'change',
      change('products', { name: 'Private product title' })
    );
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      'data: changed\n\n'
    );
    await reader.cancel();
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('view-only updates never invalidate business queries, while content and stock changes still do', () => {
  for (const [collection, field] of [
    ['products', 'count_view'],
    ['store_information', 'publication.views'],
    ['store_policies', 'publications.warranty.views'],
    ['store_policies', 'publications.shipping.views'],
  ]) {
    assert.equal(
      isBusinessChange(
        change(collection, { [field]: 2, updatedAt: new Date() })
      ),
      false
    );
    assert.equal(
      isBusinessChange(
        change(collection, {
          [field]: 2,
          [collection === 'products' ? 'stock' : 'content']: 'changed',
        })
      ),
      true
    );
    assert.equal(
      isBusinessChange({
        operationType: 'update',
        ns: { coll: collection },
        updateDescription: { removedFields: [field] },
      }),
      false
    );
  }
  assert.equal(
    isBusinessChange(
      change('store_information', { 'publication.updatedAt': new Date() })
    ),
    true
  );
  assert.equal(
    isBusinessChange(
      change('store_policies', {
        'publications.warranty.publishedAt': new Date(),
      })
    ),
    true
  );
  assert.equal(
    isBusinessChange(
      change('store_policies', {
        'publications.warranty': { views: 0, publishedAt: new Date() },
      })
    ),
    true
  );
});
