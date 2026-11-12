import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import { uploadEditorImage } from '../dist/services/editor/editor-image.service.js';
import { hasPermission } from '../dist/config/rolePermissions.js';
import { Permission } from '../dist/types/shared/permissions.type.js';
import app from '../dist/app.js';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { User } from '../dist/models/users/users.model.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';

test('editor images require content-write permission and validate files before upload', async (t) => {
  assert.ok(hasPermission('admin', Permission.ContentUpload));
  assert.ok(hasPermission('super_admin', Permission.ContentUpload));
  assert.equal(hasPermission('staff', Permission.ContentUpload), false);
  const upload = t.mock.method(cloudinary.uploader, 'upload_stream', () => {
    throw new Error('Unexpected network');
  });
  await assert.rejects(uploadEditorImage(), { status: 400 });
  await assert.rejects(
    uploadEditorImage({ buffer: Buffer.from('fake'), mimetype: 'image/png' }),
    { status: 400 }
  );
  assert.equal(upload.mock.callCount(), 0);
});
test('editor upload stores validated images in a dedicated folder and returns a secure URL', async (t) => {
  const previous = { ...process.env };
  process.env.CLOUDINARY_CLOUD_NAME = 'test';
  process.env.CLOUDINARY_API_KEY = 'test';
  process.env.CLOUDINARY_API_SECRET = 'test';
  t.after(() => {
    for (const key of [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  t.mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => {
    assert.equal(
      options.folder,
      process.env.CLOUDINARY_EDITOR_FOLDER || 'project-final/editor'
    );
    assert.deepEqual(options.allowed_formats, ['jpg', 'png', 'webp']);
    return {
      end: () =>
        callback(null, {
          public_id: 'editor/test',
          secure_url: 'https://example.com/image.png',
        }),
    };
  });
  assert.deepEqual(
    await uploadEditorImage({
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      mimetype: 'image/png',
    }),
    { url: 'https://example.com/image.png', publicId: 'editor/test' }
  );
});

test('editor image HTTP route enforces authentication, permissions and upload validation', async (t) => {
  const previous = { ...process.env };
  for (const key of [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ])
    process.env[key] = 'fixture';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  t.after(() => {
    for (const key of [
      'JWT_SECRET',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const id = 'a'.repeat(24);
  let role = 'staff';
  t.mock.method(User, 'findById', () => ({
    select: async () => ({
      _id: id,
      role,
      active: true,
      tokenVersion: 0,
      email: 'editor@test.local',
      firstName: 'Editor',
      lastName: 'Test',
    }),
  }));
  const upload = t.mock.method(
    cloudinary.uploader,
    'upload_stream',
    (_options, callback) => ({
      end: () =>
        callback(null, {
          public_id: 'editor/http',
          secure_url: 'https://example.com/image.png',
        }),
    })
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/editor/images`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const token = generateAccessToken({ id, accountType: 'user' });
  const headers = { Authorization: `Bearer ${token}`, 'X-Login-Area': 'admin' };
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 403);
  assert.equal(upload.mock.callCount(), 0);
  role = 'admin';
  headers['X-Login-Area'] = 'admin';
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 400);
  const body = new FormData();
  body.set(
    'image',
    new Blob([Buffer.from('fake')], { type: 'image/png' }),
    'bad.png'
  );
  assert.equal(
    (await fetch(url, { method: 'POST', headers, body })).status,
    400
  );
  assert.equal(upload.mock.callCount(), 0);
  body.set(
    'image',
    new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    }),
    'image.png'
  );
  const response = await fetch(url, { method: 'POST', headers, body });
  assert.equal(response.status, 201);
  assert.equal(
    (await response.json()).data.url,
    'https://example.com/image.png'
  );
});
