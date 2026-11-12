import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import app from '../dist/app.js';
import { createCategoriesSchema } from '../dist/validations/categories/categories.validation.js';
import { createBrandSchema } from '../dist/validations/brands/brands.validation.js';
import { createHeroSlideSchema } from '../dist/validations/storefront/hero-slides.validation.js';
import { createPostCategorySchema } from '../dist/validations/articles/post-categories.validation.js';
import { createArticleSchema } from '../dist/validations/articles/articles.validation.js';
import { createProductSchema } from '../dist/validations/products/products.validation.js';
import {
  createWarrantySchema,
  savePolicySchema,
} from '../dist/validations/support/support.validation.js';
import { documentInput } from '../dist/validations/support/managed-document.validation.js';
import { Categories } from '../dist/models/categories/categories.model.js';
import { BrandModel } from '../dist/models/brands/brands.model.js';
import { HeroSlide } from '../dist/models/storefront/hero-slides.model.js';
import { Article } from '../dist/models/articles/articles.model.js';
import { StoreInformation } from '../dist/models/support/information.model.js';
import { parseCatalogImage } from '../dist/middlewares/products/catalog-image.middleware.js';
import { errorMiddleware } from '../dist/middlewares/shared/error.middleware.js';

test('module descriptions accept 100,000 characters with matching schema/model limits', () => {
  const text = 'ệ'.repeat(100_000);
  const schemas = [
    createCategoriesSchema.shape.description,
    createBrandSchema.shape.description,
    createHeroSlideSchema.shape.description,
    createPostCategorySchema.shape.description,
    createArticleSchema.shape.excerpt,
    createWarrantySchema.shape.description,
    createProductSchema.shape.warrantyInformation,
    createProductSchema.shape.shippingInformation,
    createProductSchema.shape.returnPolicy,
  ];
  for (const schema of schemas) {
    assert.equal(schema.safeParse(text).success, true);
    assert.equal(schema.safeParse(text + 'x').success, false);
  }
  for (const Model of [Categories, BrandModel, HeroSlide]) {
    const doc = new Model({ description: text });
    assert.equal(doc.validateSync()?.errors.description, undefined);
    doc.description += 'x';
    assert.ok(doc.validateSync()?.errors.description);
  }
});

test('long information/articles and six policy sections honor their new bounds', () => {
  const long = 'ệ'.repeat(1_000_000);
  assert.equal(
    documentInput.safeParse({
      content: long,
      publish: false,
      expectedVersion: 0,
    }).success,
    true
  );
  for (const [Model, field] of [
    [Article, 'content'],
    [StoreInformation, 'content'],
    [StoreInformation, 'publishedContent'],
  ]) {
    const doc = new Model({ [field]: long });
    assert.equal(doc.validateSync()?.errors[field], undefined);
    doc[field] += 'x';
    assert.ok(doc.validateSync()?.errors[field]);
  }
  const content = Object.fromEntries(
    ['privacy', 'warranty', 'shipping', 'returns', 'payment', 'support'].map(
      (key) => [key, 'ệ'.repeat(100_000)]
    )
  );
  assert.equal(
    savePolicySchema.safeParse({ content, publish: true, expectedVersion: 0 })
      .success,
    true
  );
  assert.equal(
    savePolicySchema.safeParse({
      content: { ...content, warranty: content.warranty + 'x' },
      publish: false,
      expectedVersion: 0,
    }).success,
    false
  );
});

test('expanded JSON and multipart budgets preserve long Vietnamese descriptions without truncating', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const escaped = '{"description":"' + '\\u1ec7'.repeat(100_000) + '"}';
  for (const path of ['/categories', '/brands', '/hero-slides']) {
    assert.equal(
      (
        await fetch(base + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: escaped,
        })
      ).status,
      401
    );
  }
  const policy =
    '{"content":{' +
    ['privacy', 'warranty', 'shipping', 'returns', 'payment', 'support']
      .map((key) => `"${key}":"${'\\u1ec7'.repeat(100_000)}"`)
      .join(',') +
    '}}';
  assert.equal(
    (
      await fetch(base + '/support/admin/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: policy,
      })
    ).status,
    401
  );

  const uploadApp = express();
  uploadApp.post('/catalog', parseCatalogImage, (req, res) => {
    const parsed = createCategoriesSchema.safeParse(req.body);
    res
      .status(parsed.success ? 200 : 400)
      .json({ length: req.body.description.length, file: Boolean(req.file) });
  });
  uploadApp.use(errorMiddleware);
  const uploadServer = uploadApp.listen(0, '127.0.0.1');
  await once(uploadServer, 'listening');
  t.after(() => {
    uploadServer.closeAllConnections();
    uploadServer.close();
  });
  const form = new FormData();
  form.set('name', 'Catalog');
  form.set('description', 'ệ'.repeat(100_000));
  form.set(
    'image',
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    }),
    'image.png'
  );
  const uploaded = await fetch(
    `http://127.0.0.1:${uploadServer.address().port}/catalog`,
    { method: 'POST', body: form }
  );
  assert.equal(uploaded.status, 200);
  assert.deepEqual(await uploaded.json(), { length: 100_000, file: true });
});
