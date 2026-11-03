import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import app from '../dist/app.js';
import { User } from '../dist/models/users.model.js';
import { BrandModel } from '../dist/models/brands.model.js';
import { Categories } from '../dist/models/categories.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import mongoose from 'mongoose';
import { generateAccessToken } from '../dist/utils/token.js';
import { withCatalogImage } from '../dist/services/catalog-image.service.js';
import { BrandService } from '../dist/services/brands.service.js';

const id = 'a'.repeat(24);
const png = Buffer.from([137,80,78,71,13,10,26,10]);
const file = { mimetype: 'image/png', buffer: png };
function storage(t, kind = 'brands') {
  const variable = kind === 'brands' ? 'CLOUDINARY_BRAND_FOLDER' : 'CLOUDINARY_CATEGORY_FOLDER';
  const previous = process.env[variable];
  process.env[variable] = `test-catalog/${kind}`;
  t.after(() => { if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous; });
  process.env.CLOUDINARY_CLOUD_NAME = 'fixture'; process.env.CLOUDINARY_API_KEY = 'fixture'; process.env.CLOUDINARY_API_SECRET = 'fixture';
  const upload = t.mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => {
    assert.equal(options.folder, `test-catalog/${kind}`); assert.equal(options.resource_type, 'image');
    assert.equal(options.overwrite, false);
    return { end: bytes => { assert.deepEqual(bytes, png); callback(null, { public_id: 'new-image', secure_url: 'https://res.cloudinary.com/fixture/image/upload/new.png' }); } };
  });
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async () => ({ result: 'ok' }));
  return { upload, destroy };
}
test('catalog upload validates bytes before contacting Cloudinary', async t => {
  const { upload } = storage(t);
  await assert.rejects(withCatalogImage({ ...file, buffer: Buffer.from('fake') }, 'brands', async () => ({})), { status: 400 });
  await assert.rejects(withCatalogImage({ ...file, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }, 'brands', async () => ({})), { status: 413 });
  assert.equal(upload.mock.callCount(), 0);
});
test('catalog replacement cleans only the managed previous image after database success', async t => {
  const { destroy } = storage(t);
  let saved = false;
  t.mock.method(cloudinary.uploader, 'destroy', async publicId => { assert.equal(saved, true); assert.equal(publicId, 'previous-managed-image'); return { result: 'ok' }; });
  const result = await withCatalogImage(file, 'brands', async image => { assert.equal(image.publicId, 'new-image'); assert.ok(image.url.startsWith('https://')); saved = true; return { name: 'Saved' }; }, () => 'previous-managed-image');
  assert.equal(result.name, 'Saved'); assert.equal(destroy.mock.callCount(), 0);
});
test('failed database writes remove the new upload and retain the previous asset', async t => {
  const { destroy } = storage(t);
  await assert.rejects(withCatalogImage(file, 'brands', async () => { throw new Error('database failure'); }, () => 'previous'), /database failure/);
  assert.deepEqual(destroy.mock.calls.map(call => call.arguments[0]), ['new-image']);
});
test('metadata-only edits need no Cloudinary configuration or upload', async t => {
  const { upload, destroy } = storage(t);
  const result = await withCatalogImage(undefined, 'brands', async image => { assert.equal(image, undefined); return { name: 'Edited' }; });
  assert.equal(result.name, 'Edited'); assert.equal(upload.mock.callCount(), 0); assert.equal(destroy.mock.callCount(), 0);
});
test('brand replacement links the new managed asset within the existing transaction', async t => {
  const { destroy } = storage(t);
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  t.mock.method(BrandModel, 'findOne', () => ({ session: async () => ({ logoUrl: 'https://example.com/old.png', imagePublicId: 'old-managed' }) }));
  t.mock.method(BrandModel, 'findOneAndUpdate', async (_scope, update) => { assert.equal(update.$set.imagePublicId, 'new-image'); assert.ok(update.$set.logoUrl.startsWith('https://res.cloudinary.com/')); return { _id: id, ...update.$set }; });
  const result = await BrandService.update(id, { name: 'Updated' }, file);
  assert.equal(result.imagePublicId, 'new-image'); assert.equal(destroy.mock.calls[0].arguments[0], 'old-managed');
});
test('multipart brand form uses Multer/Cloudinary, keeps strict fields and blocks Staff', async t => {
  const { upload } = storage(t);
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let role = 'admin';
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: id, role, active: true, tokenVersion: 0, email: 'fixture@example.com', firstName: 'A', lastName: 'B' }) }));
  const save = t.mock.method(BrandModel, 'create', async data => { assert.equal(data.isActive, false); assert.equal(data.imagePublicId, 'new-image'); return { _id: id, ...data }; });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/brands`;
  const headers = { Authorization: `Bearer ${generateAccessToken({ id, accountType: 'user' })}`, 'X-Login-Area': 'admin' };
  const form = (bytes = png) => { const body = new FormData(); body.set('name', 'Image brand'); body.set('isActive', 'false'); body.set('image', new Blob([bytes], { type: 'image/png' }), 'logo.png'); return body; };
  assert.equal((await fetch(url, { method: 'POST', headers, body: form() })).status, 201);
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  t.mock.method(BrandModel, 'findOne', () => ({ session: async () => ({ logoUrl: 'https://example.com/legacy.png' }) }));
  t.mock.method(BrandModel, 'findOneAndUpdate', async (_scope, update) => { assert.equal(update.$set.imagePublicId, 'new-image'); assert.ok(update.$set.logoUrl.startsWith('https://res.cloudinary.com/')); return { _id: id, ...update.$set }; });
  const imageOnly = new FormData(); imageOnly.set('image', new Blob([png], { type: 'image/png' }), 'replacement.png');
  assert.equal((await fetch(`${url}/${id}`, { method: 'PUT', headers, body: imageOnly })).status, 200);
  assert.equal((await fetch(url, { method: 'POST', headers, body: form(Buffer.from('fake')) })).status, 400);
  const forged = form(); forged.set('imagePublicId', 'foreign-asset');
  assert.equal((await fetch(url, { method: 'POST', headers, body: forged })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers, body: form(Buffer.alloc(5 * 1024 * 1024 + 1)) })).status, 413);
  role = 'staff';
  assert.equal((await fetch(url, { method: 'POST', headers, body: form() })).status, 403);
  assert.equal(save.mock.callCount(), 1); assert.equal(upload.mock.callCount(), 2);
});
test('multipart category creation links the icon and parses nullable parent/boolean fields', async t => {
  storage(t, 'categories');
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  t.mock.method(User, 'findById', () => ({ select: async () => new User({ _id: id, role: 'super_admin', active: true, tokenVersion: 0, email: 'fixture@example.com' }) }));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async callback => callback({}));
  t.mock.method(Categories, 'exists', () => ({ session: async () => null }));
  t.mock.method(Categories.prototype, 'save', async function () { assert.equal(this.parent, null); assert.equal(this.isActive, false); assert.equal(this.imagePublicId, 'new-image'); assert.ok(this.icon.startsWith('https://res.cloudinary.com/')); return this; });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const body = new FormData(); body.set('name', 'Image category'); body.set('parent', 'null'); body.set('isActive', 'false'); body.set('image', new Blob([png], { type: 'image/png' }), 'category.png');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/categories`, { method: 'POST', headers: { Authorization: `Bearer ${generateAccessToken({ id, accountType: 'user' })}`, 'X-Login-Area': 'admin' }, body });
  assert.equal(response.status, 201);
});
