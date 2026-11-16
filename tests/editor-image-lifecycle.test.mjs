import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SystemLock } from '../dist/models/shared/system-locks.model.js';
import { ImageCleanupJob } from '../dist/models/products/image-cleanup-jobs.model.js';
import Product from '../dist/models/products/products.model.js';
import productService from '../dist/services/products/products.service.js';
import { StoreInformation } from '../dist/models/support/information.model.js';
import { StorePolicy } from '../dist/models/support/support.model.js';
import { saveInformation } from '../dist/services/support/information.service.js';
import { savePolicy } from '../dist/services/support/support.service.js';
import { writeDocument } from '../dist/services/support/managed-document.service.js';

const publicId = 'project-final/editor/12345678-1234-4123-8123-123456789012';
const html = `<p>Old</p><img src="https://res.cloudinary.com/test/image/upload/v1/${publicId}.png">`;
const session = {};
beforeEach((t) => {
  for (const [key, value] of Object.entries({ CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_EDITOR_FOLDER: 'project-final/editor' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(mongoose.connection, 'transaction', (work) => work(session));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
});

function queue(t) {
  return t.mock.method(ImageCleanupJob, 'bulkWrite', async (operations, options) => {
    assert.equal(options.session, session);
    assert.equal(operations[0].updateOne.filter.publicId, publicId);
    assert.equal(operations[0].updateOne.update.$setOnInsert.checkEditorReferences, true);
    return {};
  });
}

test('product description removal queues cleanup only after a successful save', async (t) => {
  const jobs = queue(t);
  const product = new Product({ description: html, __v: 0 });
  t.mock.method(Product, 'findById', () => ({ session: async () => product }));
  const save = t.mock.method(product, 'save', async () => product);
  await productService.updateProduct(String(product._id), { description: 'New text', expectedVersion: 0 });
  assert.equal(jobs.mock.callCount(), 1);
  product.description = html;
  save.mock.mockImplementation(async () => { throw new Error('Save failed'); });
  await assert.rejects(productService.updateProduct(String(product._id), { description: '', expectedVersion: 0 }), /Save failed/);
  assert.equal(jobs.mock.callCount(), 1);
});

for (const kind of ['information', 'policy', 'managed-information', 'managed-policy']) {
  test(`${kind} retains public snapshot images until publication removes the last reference`, async (t) => {
    const jobs = queue(t);
    const policy = kind.endsWith('policy');
    const Model = policy ? StorePolicy : StoreInformation;
    let state = {
      _id: policy ? 'store-policy' : 'gioi-thieu',
      __v: 1,
      content: policy ? { privacy: html } : html,
      publishedContent: policy ? { privacy: html } : html,
      publishedAt: new Date(),
    };
    t.mock.method(Model, 'findById', () => ({ lean: async () => structuredClone(state) }));
    t.mock.method(Model, 'findOneAndUpdate', async (filter, update, options) => {
      assert.equal(options.session, session);
      if (filter.__v !== state.__v) return null;
      for (const [path, value] of Object.entries(update.$set)) {
        const parts = path.split('.');
        let target = state;
        for (const part of parts.slice(0, -1)) { target[part] ??= {}; target = target[part]; }
        target[parts.at(-1)] = value;
      }
      state.__v++;
      return new Model(state);
    });
    const run = (publish, expectedVersion) => {
      const input = { content: 'New text', publish, expectedVersion };
      if (kind === 'information') return saveInformation('gioi-thieu', input);
      if (kind === 'policy') return savePolicy({ ...input, content: { privacy: 'New text', warranty: '', returns: '', shipping: '', payment: '', support: '' } });
      return writeDocument(policy ? 'privacy' : 'gioi-thieu', input);
    };
    await run(false, 1);
    assert.equal(jobs.mock.callCount(), 0);
    await run(true, 2);
    assert.equal(jobs.mock.callCount(), 1);
    await assert.rejects(run(true, 1), { status: 409 });
    assert.equal(jobs.mock.callCount(), 1);
  });
}
