import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import app from '../dist/app.js';
import { createArticleSchema } from '../dist/validations/articles.validation.js';

test('editorial JSON budget accepts Unicode/escaped schema boundaries but stays bounded and scoped', async t => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const input = { title: 'Article boundary', category: 'News', excerpt: 'Summary', authorName: 'Editor', content: '\u1ec7'.repeat(100000) };
  assert.equal(createArticleSchema.safeParse(input).success, true);
  const send = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  for (const body of [JSON.stringify(input), JSON.stringify(input).replaceAll('\u1ec7', '\\u1ec7')]) {
    assert.ok(Buffer.byteLength(body) > 100 * 1024);
    assert.equal((await send('/articles', body)).status, 401, 'Valid article passes parsing and reaches authentication');
  }
  assert.equal(createArticleSchema.safeParse({ ...input, content: input.content + 'x' }).success, false);
  const oversized = await send('/articles', JSON.stringify({ ...input, content: 'x'.repeat(1024 * 1024) }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).success, false);
  assert.equal((await send('/auth/login', JSON.stringify(input))).status, 413, 'Unrelated endpoints retain the smaller limit');
});
