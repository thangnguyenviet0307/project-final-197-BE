import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import app from '../dist/app.js';
import Product from '../dist/models/products/products.model.js';
import { createProductSchema, updateProductSchema } from '../dist/validations/products/products.validation.js';

test('product descriptions accept one million characters in schema/model and reject overflow', () => {
  const description = 'ệ'.repeat(1_000_000);
  assert.equal(createProductSchema.shape.description.safeParse(description).success, true);
  assert.equal(updateProductSchema.safeParse({ description }).success, true);
  assert.equal(createProductSchema.shape.description.safeParse(description + 'x').success, false);
  assert.equal(updateProductSchema.safeParse({ description: description + 'x' }).success, false);
  const product = new Product({ description });
  assert.equal(product.validateSync()?.errors?.description, undefined);
  product.description += 'x';
  assert.ok(product.validateSync()?.errors?.description);
});

test('product write JSON supports escaped Unicode and remains bounded and scoped', async t => {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/products`;
  const send = (path, method, body) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body,
  });
  const body = '{"description":"' + '\\u1ec7'.repeat(1_000_000) + '"}';
  assert.equal((await send('', 'POST', body)).status, 401);
  assert.equal((await send('/' + 'a'.repeat(24), 'PUT', body)).status, 401);
  assert.equal((await send('/public/test-product/reviews', 'POST', body)).status, 413);
  assert.equal((await send('', 'POST', JSON.stringify({ description: 'x'.repeat(8 * 1024 * 1024) }))).status, 413);
});
