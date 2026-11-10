import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import app from '../dist/app.js';
import { StorePolicy } from '../dist/models/support.model.js';
import { StoreInformation } from '../dist/models/information.model.js';
import { User } from '../dist/models/users.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { documentParams, documentInput, documentVersion } from '../dist/validations/managed-document.validation.js';
import * as service from '../dist/services/managed-document.service.js';

function harness(t, Model, initial) {
  let state = initial;
  t.mock.method(Model, 'findById', () => ({ lean: async () => state ? structuredClone(state) : null }));
  const write = t.mock.method(Model, 'findOneAndUpdate', async (filter, update) => {
    if (state && state.__v !== filter.__v) return null;
    state ??= { _id: filter._id, __v: 0 };
    for (const [path, value] of Object.entries(update.$set)) {
      const parts = path.split('.'); let target = state;
      for (const part of parts.slice(0, -1)) { target[part] ??= {}; target = target[part]; }
      target[parts.at(-1)] = value;
    }
    state.__v += 1;
    return new Model(state);
  });
  return { state: () => state, write };
}

test('managed inputs reject unknown keys, empty publication, forged metadata and missing versions', () => {
  assert.equal(documentParams.safeParse({ key: 'privacy' }).success, true);
  assert.equal(documentParams.safeParse({ key: '$where' }).success, false);
  assert.equal(documentParams.safeParse({ key: 'payment' }).success, false);
  assert.equal(documentParams.safeParse({ key: 'support' }).success, false);
  const input = { content: '<h2>Title</h2><p>Content</p>', expectedVersion: 1, publish: true };
  assert.equal(documentInput.safeParse(input).success, true);
  for (const change of [{ content: '<p><br></p>' }, { views: 100 }, { publishedAt: new Date() }, { expectedVersion: -1 }]) assert.equal(documentInput.safeParse({ ...input, ...change }).success, false);
  assert.equal(documentVersion.safeParse({}).success, false);
});
test('first section publication, update, deletion and republication preserve unrelated policies', async t => {
  const date = new Date('2025-01-01');
  const h = harness(t, StorePolicy, { _id: 'store-policy', __v: 2, content: { privacy: 'draft', warranty: 'Warranty' }, publishedContent: { warranty: 'Warranty' }, publishedAt: date });
  const first = await service.writeDocument('privacy', { content: 'Privacy', expectedVersion: 2, publish: true });
  const firstDate = first.publishedAt.getTime();
  assert.equal(first.updatedAt, null); assert.equal(first.views, 0);
  assert.notEqual(firstDate, date.getTime());
  h.state().publications.privacy.views = 7;
  const updated = await service.writeDocument('privacy', { content: 'Changed', expectedVersion: 3, publish: true });
  assert.equal(updated.publishedAt.getTime(), firstDate);
  assert.ok(updated.updatedAt instanceof Date); assert.equal(updated.views, 7);
  const unchanged = await service.writeDocument('privacy', { content: 'Changed', expectedVersion: 4, publish: true });
  assert.equal(unchanged.updatedAt.getTime(), updated.updatedAt.getTime());
  await service.writeDocument('privacy', { content: '', expectedVersion: 5, publish: false }, true);
  assert.equal(await service.readDocument('privacy'), null);
  assert.equal(h.state().publishedContent.warranty, 'Warranty');
  assert.equal(h.state().content.warranty, 'Warranty');
  const again = await service.writeDocument('privacy', { content: 'New publication', expectedVersion: 6, publish: true });
  assert.equal(again.views, 0); assert.equal(again.updatedAt, null);
  assert.ok(again.publishedAt.getTime() >= firstDate);
});
test('draft saves do not change public content or publication metadata', async t => {
  const date = new Date('2025-01-01');
  harness(t, StoreInformation, { _id: 'gioi-thieu', __v: 3, content: 'Published', publishedContent: 'Published', publishedAt: date, publication: { publishedAt: date, updatedAt: null, views: 4 } });
  const result = await service.writeDocument('gioi-thieu', { content: 'Private draft', expectedVersion: 3, publish: false });
  assert.equal(result.__v, 4);
  assert.deepEqual(await service.readDocument('gioi-thieu'), { content: 'Published', publishedAt: date, updatedAt: null, views: 4 });
});
test('legacy reads preserve old publication date and safely default new metadata without writes', async t => {
  const date = new Date('2025-01-01');
  const h = harness(t, StorePolicy, { _id: 'store-policy', __v: 3, content: { warranty: 'draft' }, publishedContent: { warranty: 'published' }, publishedAt: date });
  assert.deepEqual(await service.readDocument('warranty'), { content: 'published', publishedAt: date, updatedAt: null, views: 0 });
  assert.equal(h.write.mock.callCount(), 0);
});
test('first publication handles a legacy null policy snapshot and missing documents', async t => {
  const h = harness(t, StorePolicy, { _id: 'store-policy', __v: 1, content: { privacy: 'Draft' }, publishedContent: null });
  await service.writeDocument('privacy', { content: 'Public', expectedVersion: 1, publish: true });
  assert.equal(h.write.mock.calls[0].arguments[1].$set.publishedContent.privacy, 'Public');
  assert.equal((await service.readDocument('privacy')).content, 'Public');
  harness(t, StoreInformation, null);
  const first = await service.writeDocument('cau-hoi-thuong-gap', { content: 'FAQ', expectedVersion: 0, publish: true });
  assert.equal(first.__v, 1); assert.ok(first.publishedAt instanceof Date);
});
test('stale writes/deletes and oversized sections are rejected before changing storage', async t => {
  const h = harness(t, StorePolicy, { _id: 'store-policy', __v: 5, content: { privacy: 'Draft' } });
  await assert.rejects(service.writeDocument('privacy', { content: 'Changed', expectedVersion: 4, publish: false }), { status: 409 });
  await assert.rejects(service.writeDocument('privacy', { content: '', expectedVersion: 4, publish: false }, true), { status: 409 });
  await assert.rejects(service.writeDocument('privacy', { content: 'x'.repeat(100001), expectedVersion: 5, publish: false }), { status: 400 });
  assert.equal(h.write.mock.callCount(), 0);
});
test('atomic conflict and duplicate first insert cannot overwrite another editor', async t => {
  t.mock.method(StoreInformation, 'findById', () => ({ lean: async () => null }));
  t.mock.method(StoreInformation, 'findOneAndUpdate', async () => { throw { code: 11000 }; });
  await assert.rejects(service.writeDocument('gioi-thieu', { content: 'Draft', expectedVersion: 0, publish: false }), { status: 409 });
});
test('view counters update only published content without version or timestamp writes', async t => {
  t.mock.method(StorePolicy, 'findOneAndUpdate', async (filter, pipeline, options) => {
    assert.deepEqual(filter['publishedContent.privacy'], { $type: 'string', $ne: '' });
    assert.deepEqual(pipeline, [{ $set: { 'publications.privacy.views': { $add: [{ $ifNull: ['$publications.privacy.views', 0] }, 1] } } }]);
    assert.equal(options.timestamps, false);
    return new StorePolicy({ publications: { privacy: { views: 12 } } });
  });
  assert.deepEqual(await service.recordDocumentView('privacy'), { views: 12 });
});
test('managed APIs enforce authentication/roles and validate keys before writes', async t => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const id = 'a'.repeat(24);
  t.mock.method(StorePolicy, 'findById', () => ({ lean: async () => null }));
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: id, role: 'staff', active: true, tokenVersion: 0 }) }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/support`;
  assert.equal((await fetch(`${base}/documents/privacy`)).status, 200);
  assert.equal((await fetch(`${base}/documents/invalid`)).status, 400);
  assert.equal((await fetch(`${base}/admin/documents`)).status, 401);
  const headers = { Authorization: `Bearer ${generateAccessToken({ id, accountType: 'user' })}`, 'X-Login-Area': 'admin', 'Content-Type': 'application/json' };
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await fetch(`${base}/admin/documents/privacy`, { method, headers, ...(method !== 'GET' ? { body: JSON.stringify({ expectedVersion: 0 }) } : {}) })).status, 403);
  }
});


test('managed policy saves accept long formatted content and reject overflow', async t => {
  harness(t, StorePolicy, { _id: 'store-policy', __v: 0, content: {} });
  const content = '<p>' + 'a'.repeat(99993) + '</p>';
  const saved = await service.writeDocument('privacy', { content, expectedVersion: 0, publish: false });
  assert.equal(saved.content, content);
  await assert.rejects(service.writeDocument('privacy', { content: content + 'a', expectedVersion: 1, publish: false }), { status: 400 });
});
