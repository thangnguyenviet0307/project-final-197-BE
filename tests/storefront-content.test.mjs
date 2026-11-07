import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import app from '../dist/app.js';

let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/v1/storefront/pages`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('public about page returns the complete structured content without authentication', async () => {
  const response = await fetch(`${base}/about`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.data.eyebrow, 'VỀ DEMOSTORE');
  assert.equal(typeof result.data.title, 'string');
  assert.equal(typeof result.data.highlight, 'string');
  assert.ok(result.data.story.paragraphs.length >= 3);
  assert.ok(result.data.offerings.length >= 4);
  assert.ok(result.data.principles.length >= 3);
  assert.ok(result.data.steps.length >= 3);
  assert.equal(typeof result.data.notice.description, 'string');
  assert.equal(JSON.stringify(result).includes('password'), false);
});

test('public FAQ page returns categorized searchable questions without authentication', async () => {
  const response = await fetch(`${base}/faq`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.data.title, 'Câu hỏi thường gặp');
  assert.ok(result.data.categories.length >= 5);
  const questions = result.data.categories.flatMap(
    (category) => category.questions
  );
  assert.ok(questions.length >= 20);
  assert.ok(
    questions.every(
      (question) =>
        typeof question.id === 'string' &&
        typeof question.question === 'string' &&
        typeof question.answer === 'string'
    )
  );
  assert.ok(questions.some((question) => question.id === 'checkout'));
});
