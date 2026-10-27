import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import app from '../dist/app.js';
import { HeroSlide } from '../dist/models/hero-slides.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { User } from '../dist/models/users.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { createHeroSlideSchema, updateHeroSlideSchema, heroSlideVersionSchema } from '../dist/validations/hero-slides.validation.js';
import * as service from '../dist/services/hero-slides.service.js';
const id = 'a'.repeat(24);
const input = { category: id, title: 'A custom hero title' };
process.env.JWT_SECRET = randomBytes(32).toString('hex');
function transaction(t) {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async work => work({}));
}

test('hero inputs are strict, bounded and partial updates never reset omitted fields', () => {
  assert.deepEqual(createHeroSlideSchema.parse(input), { ...input, description: '', imageUrl: null, sortOrder: 0, isActive: true });
  assert.deepEqual(updateHeroSlideSchema.parse({ expectedVersion: 2, title: 'Changed' }), { expectedVersion: 2, title: 'Changed' });
  for (const fields of [{ expectedVersion: 2 }, { title: 'Changed' }, { expectedVersion: 2, category: 'bad' }, { expectedVersion: 2, imageUrl: 'javascript:alert(1)' }, { expectedVersion: -1, title: 'Changed' }, { expectedVersion: 0, sortOrder: 1.5 }, { expectedVersion: 0, buttonLabel: 'Override' }]) assert.equal(updateHeroSlideSchema.safeParse(fields).success, false);
  for (const extra of [{ title: ' ' }, { title: 'a'.repeat(201) }, { description: 'b'.repeat(1001) }, { sortOrder: -1 }, { imageUrl: 'data:image/png;base64,x' }, { category: 'bad' }, { expectedVersion: 0 }]) assert.equal(createHeroSlideSchema.safeParse({ ...input, ...extra }).success, false);
  assert.equal(heroSlideVersionSchema.safeParse({ expectedVersion: 0, isActive: true }).success, false);
});

test('public hero excludes unpublished and inactive-category slides and exposes only public fields in stable order', async t => {
  t.mock.method(Categories, 'distinct', async (field, filter) => { assert.equal(field, '_id'); assert.deepEqual(filter, { isActive: true, isDeleted: { $ne: true } }); return [id]; });
  t.mock.method(HeroSlide, 'find', filter => {
    assert.deepEqual(filter, { isActive: true, category: { $in: [id] } });
    return { select(fields) { assert.equal(fields, '_id category title description imageUrl sortOrder'); return this; }, populate(value) { assert.deepEqual(value, { path: 'category', select: '_id name icon', match: { isActive: true, isDeleted: { $ne: true } } }); return this; }, sort(value) { assert.deepEqual(value, { sortOrder: 1, _id: 1 }); return this; }, limit(value) { assert.equal(value, 50); return this; }, lean: async () => [{ category: null }] };
  });
  assert.deepEqual(await service.listHeroSlides(true), []);
});

test('create persists custom content with defaults and validates active references and the 50-slide cap', async t => {
  transaction(t);
  let count = 0; let active = true;
  t.mock.method(HeroSlide, 'countDocuments', () => ({ session: async () => count }));
  t.mock.method(Categories, 'exists', filter => { assert.equal(String(filter._id), id); assert.equal(filter.isActive, true); return { session: async () => active ? {} : null }; });
  const save = t.mock.method(HeroSlide.prototype, 'save', async function () { return this; });
  const result = await service.createHeroSlide(createHeroSlideSchema.parse(input));
  assert.equal(result.title, input.title); assert.equal(result.sortOrder, 0); assert.equal(result.description, '');
  active = false;
  await assert.rejects(service.createHeroSlide(input), { status: 409 });
  count = 50;
  await assert.rejects(service.createHeroSlide(input), { status: 409 });
  assert.equal(save.mock.callCount(), 1);
});

test('updates preserve existing content and reject stale versions; deletes require the reviewed version', async t => {
  transaction(t);
  const slide = new HeroSlide({ ...input, description: 'Keep description', imageUrl: 'https://images.test/hero.jpg', sortOrder: 9, __v: 2 });
  t.mock.method(HeroSlide, 'findById', () => ({ session: async () => slide }));
  const save = t.mock.method(slide, 'save', async () => { slide.__v++; return slide; });
  const exists = t.mock.method(Categories, 'exists', () => ({ session: async () => null }));
  const result = await service.updateHeroSlide(String(slide._id), { expectedVersion: 2, title: 'Changed' });
  assert.equal(result.title, 'Changed'); assert.equal(result.description, 'Keep description'); assert.equal(result.sortOrder, 9); assert.equal(exists.mock.callCount(), 0);
  await assert.rejects(service.updateHeroSlide(String(slide._id), { expectedVersion: 2, title: 'Overwrite' }), { status: 409 });
  await assert.rejects(service.updateHeroSlide(String(slide._id), { expectedVersion: 3, category: id }), { status: 409 });
  await assert.rejects(service.deleteHeroSlide(String(slide._id), 2), { status: 409 });
  const remove = t.mock.method(HeroSlide, 'deleteOne', async filter => { assert.deepEqual(filter, { _id: String(slide._id), __v: 3 }); return { deletedCount: 1 }; });
  await service.deleteHeroSlide(String(slide._id), 3);
  assert.equal(remove.mock.callCount(), 1); assert.equal(save.mock.callCount(), 1);
});

test('missing hero updates and deletes return 404', async t => {
  transaction(t); t.mock.method(HeroSlide, 'findById', () => ({ session: async () => null }));
  await assert.rejects(service.updateHeroSlide(id, { expectedVersion: 0, title: 'Changed' }), { status: 404 });
  await assert.rejects(service.deleteHeroSlide(id, 0), { status: 404 });
});

test('public hero is anonymous while all management endpoints enforce admin authentication and validation', async t => {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/hero-slides`;
  let role = 'staff';
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: id, email: 'test@example.com', firstName: 'Test', lastName: 'User', role, active: true, tokenVersion: 0 }) }));
  t.mock.method(Categories, 'distinct', async () => []);
  t.mock.method(HeroSlide, 'find', () => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [] }));
  assert.equal((await fetch(base + '/public')).status, 200);
  const request = (method, path, body, token) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const token = generateAccessToken({ id });
  for (const [method, path, body] of [['GET', '', undefined], ['POST', '', input], ['PATCH', '/' + id, { expectedVersion: 0, title: 'Changed' }], ['DELETE', '/' + id, { expectedVersion: 0 }]]) {
    assert.equal((await request(method, path, body)).status, 401);
    assert.equal((await request(method, path, body, token)).status, 403);
    assert.equal((await request(method, path, body, generateAccessToken({ id, accountType: 'customer' }))).status, 403);
  }
  role = 'admin';
  assert.equal((await request('GET', '', undefined, token)).status, 200);
  assert.equal((await request('POST', '', { ...input, buttonLabel: 'Injected' }, token)).status, 400);
  assert.equal((await request('PATCH', '/' + id, { title: 'Changed' }, token)).status, 400);
  assert.equal((await request('PATCH', '/bad', { expectedVersion: 0, title: 'Changed' }, token)).status, 400);
  assert.equal((await request('DELETE', '/' + id, {}, token)).status, 400);
});
