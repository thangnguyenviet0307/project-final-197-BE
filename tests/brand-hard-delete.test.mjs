import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BrandModel } from '../dist/models/brands.model.js';
import Product from '../dist/models/products.model.js';
import { SystemLock } from '../dist/models/system-locks.model.js';
import { BrandService } from '../dist/services/brands.service.js';

test('brand deletion removes the document, including legacy soft-deleted brands, and protects product references', async t => {
  const id = 'a'.repeat(24); const session = {};
  t.mock.method(mongoose.connection, 'transaction', async work => work(session));
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  let referenced = false;
  t.mock.method(Product, 'exists', () => ({ session: async () => referenced ? { _id: id } : null }));
  const remove = t.mock.method(BrandModel, 'findByIdAndDelete', async (actual, options) => {
    assert.equal(actual, id); assert.equal(options.session, session); return { _id: id };
  });
  assert.equal((await BrandService.delete(id))._id, id);
  referenced = true;
  await assert.rejects(BrandService.delete(id), { status: 409 });
  assert.equal(remove.mock.callCount(), 1);
});

test('catalog metadata API rejects soft-delete flags and client-owned identifiers', async () => {
  const { createBrandSchema, updateBrandSchema } = await import('../dist/validations/brands.validation.js');
  const { createCategoriesSchema, updateCategoriesSchema } = await import('../dist/validations/categories.validation.js');
  for (const schema of [createBrandSchema, createCategoriesSchema]) {
    for (const field of ['isDeleted', 'deletedAt', 'slug', '_id']) assert.equal(schema.safeParse({ name: 'Safe', [field]: true }).success, false);
  }
  for (const schema of [updateBrandSchema, updateCategoriesSchema]) assert.equal(schema.safeParse({ name: 'Safe', isDeleted: true }).success, false);
});
