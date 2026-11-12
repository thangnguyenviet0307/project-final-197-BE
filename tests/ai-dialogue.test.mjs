import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogSort,
  quickClarification,
  relevantPassages,
} from '../dist/services/ai/dialogue.js';
import {
  classifyAiFailure,
  reportAiFailure,
  aiError,
} from '../dist/services/ai/failures.js';

test('catalog intents and incomplete quick prompts are deterministic', () => {
  assert.equal(
    catalogSort('Sản phẩm có GIÁ THẤP NHẤT trong cửa hàng'),
    'price_asc'
  );
  assert.equal(catalogSort('Loại đắt nhất'), 'price_desc');
  assert.equal(catalogSort('Hàng mới nhất'), 'newest');
  assert.equal(catalogSort('Gợi ý tai nghe'), undefined);
  assert.match(quickClarification('So sánh sản phẩm'), /ít nhất hai/);
  assert.equal(quickClarification('Tìm tai nghe dưới 500k'), undefined);
});

test('published policy retrieval finds relevant content beyond the first 1800 characters', () => {
  const tail = 'Thời hạn đổi pin lỗi kỹ thuật là 37 ngày kể từ ngày nhận.';
  const body = 'Thông tin giới thiệu cửa hàng. '.repeat(500) + tail;
  const selected = relevantPassages(
    body,
    'Thời hạn đổi pin lỗi kỹ thuật bao nhiêu ngày?'
  );
  assert.ok(selected.includes(tail));
  assert.ok(selected.length <= 1800);
  assert.ok(
    !relevantPassages(body, 'pin', ['Nội dung cũ đã bị xóa']).includes(
      'Nội dung cũ đã bị xóa'
    )
  );
});

test('AI failures distinguish quota, rate, auth, timeout and output limits without logging secrets', (t) => {
  assert.equal(
    classifyAiFailure({ status: 429, code: 'insufficient_quota' }, 'intent')
      .code,
    'AI_CREDIT_EXHAUSTED'
  );
  assert.equal(
    classifyAiFailure({ status: 429 }, 'generation').code,
    'AI_RATE_LIMITED'
  );
  assert.equal(
    classifyAiFailure({ status: 401 }, 'intent').code,
    'AI_AUTH_ERROR'
  );
  assert.equal(
    classifyAiFailure({ name: 'APIConnectionTimeoutError' }, 'generation').code,
    'AI_TIMEOUT'
  );
  assert.equal(
    classifyAiFailure(aiError('AI_OUTPUT_LIMIT'), 'generation').code,
    'AI_OUTPUT_LIMIT'
  );
  const log = t.mock.method(console, 'warn', () => {});
  reportAiFailure(
    {
      status: 429,
      message: 'private-key-and-customer-question',
      body: 'secret',
    },
    'intent',
    'safe-id'
  );
  const output = JSON.stringify(log.mock.calls);
  assert.ok(!output.includes('private-key'));
  assert.ok(!output.includes('secret'));
});
