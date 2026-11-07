import test from 'node:test';
import assert from 'node:assert/strict';
import { getCloudinaryFolder } from '../dist/config/cloudinary-folders.js';

test('folder defaults preserve existing upload locations', () => {
  for (const kind of ['products', 'brands', 'categories', 'warranty'])
    assert.equal(getCloudinaryFolder(kind, {}), `project-final/${kind}`);
});
test('each image type resolves its own environment folder without affecting others', () => {
  const env = {
    CLOUDINARY_PRODUCT_FOLDER: 'project-final-197/products',
    CLOUDINARY_BRAND_FOLDER: 'project-final-197/brands',
    CLOUDINARY_CATEGORY_FOLDER: 'project-final-197/categories',
    CLOUDINARY_WARRANTY_FOLDER: 'project-final-197/warranty',
  };
  for (const kind of ['products', 'brands', 'categories', 'warranty'])
    assert.equal(getCloudinaryFolder(kind, env), `project-final-197/${kind}`);
  assert.equal(
    getCloudinaryFolder('brands', {
      CLOUDINARY_BRAND_FOLDER: ' /custom/brands/ ',
    }),
    'custom/brands'
  );
});
test('invalid folders fail without echoing untrusted values', () => {
  for (const value of [
    '../outside',
    'https://example.com/path',
    'folder//empty',
    ' ',
    'x'.repeat(81),
  ]) {
    assert.throws(
      () =>
        getCloudinaryFolder('warranty', { CLOUDINARY_WARRANTY_FOLDER: value }),
      (error) =>
        error.status === 503 &&
        error.message ===
          'Invalid image folder configuration: CLOUDINARY_WARRANTY_FOLDER'
    );
  }
});
