import { v2 as cloudinary } from 'cloudinary';
import { processImageCleanupBatch } from '../dist/services/products/image-cleanup.service.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Article } from '../dist/models/articles/articles.model.js';
import { ImageCleanupJob } from '../dist/models/products/image-cleanup-jobs.model.js';
import { SystemLock } from '../dist/models/shared/system-locks.model.js';
import { updateArticle } from '../dist/services/articles/articles.service.js';
import { editorImageIds, isEditorImageReferenced } from '../dist/services/editor/editor-image-cleanup.service.js';

const imageId = 'project-final/editor/12345678-1234-4123-8123-123456789012';
const url = `https://res.cloudinary.com/test/image/upload/v123/${imageId}.png`;

function configureEnvironment(t) {
  for (const [key, value] of Object.entries({ CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_EDITOR_FOLDER: 'project-final/editor', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('only our Cloudinary editor uploads are eligible for removal', (t) => {
  configureEnvironment(t);
  assert.deepEqual(editorImageIds(`<img src="${url}"><img src='${url}'>`), [imageId]);
  for (const src of [url.replace('/test/', '/foreign/'), url.replace('/editor/', '/products/'), 'https://example.com/a.png', 'data:image/png;base64,AAAA'])
    assert.deepEqual(editorImageIds(`<img src="${src}">`), []);
});

test('queues removed inline images in the save transaction, never on failed or stale updates', async (t) => {
  configureEnvironment(t);
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', (work) => work(session));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  const queued = t.mock.method(ImageCleanupJob, 'bulkWrite', async () => ({}));
  const article = new Article({ title: 'Test', content: `<p>Old</p><img src="${url}">`, status: 'draft', __v: 0 });
  t.mock.method(Article, 'findById', () => ({ session: async () => article }));
  const save = t.mock.method(Article.prototype, 'save', async function () { return this; });
  const user = { id: 'a'.repeat(24), role: 'admin' };
  await updateArticle(String(article._id), { expectedVersion: 0, title: 'Metadata only' }, user);
  assert.equal(queued.mock.callCount(), 0);
  await updateArticle(String(article._id), { expectedVersion: 0, content: `<p>Keep</p><img src="${url}">` }, user);
  assert.equal(queued.mock.callCount(), 0);
  await updateArticle(String(article._id), { expectedVersion: 0, content: '<p>Text only</p>' }, user);
  assert.equal(queued.mock.callCount(), 1);
  const [operations, options] = queued.mock.calls[0].arguments;
  assert.equal(operations[0].updateOne.filter.publicId, imageId);
  assert.equal(operations[0].updateOne.update.$setOnInsert.checkEditorReferences, true);
  assert.equal(options.session, session);
  await assert.rejects(updateArticle(String(article._id), { expectedVersion: 9, content: 'Other' }, user), { status: 409 });
  article.content = `<img src="${url}">`;
  save.mock.mockImplementation(async () => { throw new Error('Save failed'); });
  await assert.rejects(updateArticle(String(article._id), { expectedVersion: 0, content: 'Other' }, user), /Save failed/);
  assert.equal(queued.mock.callCount(), 1);
});

test('shared images are retained across article and other rich text documents', async (t) => {
  const checked = [];
  t.mock.method(mongoose.connection, 'collection', (name) => ({
    findOne: async (query) => {
      checked.push(name);
      assert.ok(query.$or.some((field) => Object.values(field)[0].test(url)));
      return name === 'store_information' ? { _id: 'shared' } : null;
    },
  }));
  assert.equal(await isEditorImageReferenced(imageId), true);
  assert.ok(checked.includes('posts'));
  assert.ok(checked.includes('products'));
});

for (const referenced of [false, true]) test(`cleanup worker ${referenced ? 'retains shared' : 'deletes removed'} editor images`, async (t) => {
  configureEnvironment(t);
  let claimed = false;
  t.mock.method(ImageCleanupJob, 'findOneAndUpdate', async () => {
    if (claimed) return null;
    claimed = true;
    return { _id: 'job', publicId: imageId, checkEditorReferences: true, attempts: 0 };
  });
  t.mock.method(mongoose.connection, 'collection', () => ({ findOne: async () => referenced ? { _id: 'reference' } : null }));
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async () => ({ result: 'ok' }));
  const removeJob = t.mock.method(ImageCleanupJob, 'deleteOne', async () => ({}));
  await processImageCleanupBatch();
  assert.equal(destroy.mock.callCount(), referenced ? 0 : 1);
  assert.equal(removeJob.mock.callCount(), 1);
});
