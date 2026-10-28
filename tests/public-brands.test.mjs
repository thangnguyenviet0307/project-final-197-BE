import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { BrandModel } from '../dist/models/brands.model.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');

test('public brand filter exposes only active public fields without opening admin endpoints', async t => {
  const brands = [{ _id: 'a'.repeat(24), name: 'Anker', slug: 'anker', logoUrl: 'https://example.com/anker.png' }];
  t.mock.method(BrandModel, 'find', filter => {
    assert.deepEqual(filter, { isActive: true, isDeleted: { $ne: true } });
    return {
      select(projection) { assert.equal(projection, '_id name slug logoUrl'); return this; },
      sort(order) { assert.deepEqual(order, { name: 1, _id: 1 }); return this; },
      lean: async () => brands,
    };
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/brands`;
  const response = await fetch(base + '/public');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, brands);
  assert.equal((await fetch(base)).status, 401);
});
