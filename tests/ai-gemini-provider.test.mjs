import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { aiProvider } from '../dist/services/ai/providers/gemini.provider.js';
import { classifyAiFailure } from '../dist/services/ai/failures.js';
import { validateAiEnvironment } from '../dist/services/ai/environment.js';

function configure(t) {
  for (const [key, value] of Object.entries({
    AI_ENABLED: 'true',
    GEMINI_API_KEY: 'mock-gemini-key',
    AI_CHAT_MODEL: 'gemini-3.1-flash-lite',
    AI_EMBEDDING_MODEL: 'gemini-embedding-001',
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(mongoose.Query.prototype, 'exec', async () => ({
    modifiedCount: 1,
  }));
}
const intent = {
  search: 'tai nghe',
  brand: null,
  category: null,
  minPrice: null,
  maxPrice: 500000,
  sort: 'price_asc',
  task: 'search',
  inherit: false,
  productNames: [],
  referencePositions: [],
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('Gemini intent uses Google transport and strict JSON without OpenAI credentials', async (t) => {
  configure(t);
  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(
      String(url),
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    );
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer mock-gemini-key'
    );
    request = JSON.parse(init.body);
    return json({
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(intent) },
        },
      ],
    });
  });
  assert.deepEqual(
    await aiProvider.interpretQuery('Tìm tai nghe rẻ nhất dưới 500k'),
    intent
  );
  assert.equal(request.model, 'gemini-3.1-flash-lite');
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.max_tokens, 1536);
  assert.equal(request.reasoning_effort, 'low');
  assert.ok(!('input' in request));
});

test('Gemini SSE preserves streaming and requires a successful terminal reason', async (t) => {
  configure(t);
  let finish = 'stop';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(
      String(url).startsWith('https://generativelanguage.googleapis.com/')
    );
    const request = JSON.parse(init.body);
    assert.equal(request.stream, true);
    assert.equal(
      typeof JSON.parse(request.messages.at(-1).content).verifiedStoreData,
      'object'
    );
    const chunks = [
      {
        choices: [
          { index: 0, delta: { content: 'Xin chào' }, finish_reason: null },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    ];
    return new Response(
      chunks
        .map((chunk) => 'data: ' + JSON.stringify(chunk) + '\n\n')
        .join('') + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  });
  async function read() {
    let answer = '';
    for await (const delta of aiProvider.answerStream(
      'Chào',
      '{"products":[]}',
      [],
      new AbortController().signal
    ))
      answer += delta;
    return answer;
  }
  assert.equal(await read(), 'Xin chào');
  finish = 'length';
  await assert.rejects(read(), (error) => error.aiCode === 'AI_OUTPUT_LIMIT');
  finish = 'content_filter';
  await assert.rejects(
    read(),
    (error) => error.aiCode === 'AI_INVALID_RESPONSE'
  );
});

test('Gemini validates JSON, refuses truncated intent and never falls back after free-tier quota exhaustion', async (t) => {
  configure(t);
  let response = json({
    choices: [{ finish_reason: 'stop', message: { content: '{broken' } }],
  });
  const network = t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(
    aiProvider.interpretQuery('q'),
    (e) => e.aiCode === 'AI_INVALID_RESPONSE'
  );
  response = json({
    choices: [{ finish_reason: 'length', message: { content: '{}' } }],
  });
  await assert.rejects(
    aiProvider.interpretQuery('q'),
    (e) => e.aiCode === 'AI_OUTPUT_LIMIT'
  );
  response = json(
    {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'private provider details',
      },
    },
    429
  );
  await assert.rejects(
    aiProvider.interpretQuery('q'),
    (e) => classifyAiFailure(e, 'intent').code === 'AI_RATE_LIMITED'
  );
  assert.equal(network.mock.callCount(), 3);
});

test('Gemini embeddings keep the 1536-dimension index contract and normalize vectors', async (t) => {
  configure(t);
  let values = [3, 4, ...Array(1534).fill(0)];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(
      String(url),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'
    );
    assert.equal(
      new Headers(init.headers).get('x-goog-api-key'),
      'mock-gemini-key'
    );
    assert.equal(JSON.parse(init.body).outputDimensionality, 1536);
    assert.ok(!String(url).includes('mock-gemini-key'));
    return json({ embedding: { values } });
  });
  const vector = await aiProvider.embed('tai nghe');
  assert.equal(vector.length, 1536);
  assert.equal(vector[0], 0.6);
  assert.equal(vector[1], 0.8);
  values = [1, 2];
  await assert.rejects(
    aiProvider.embed('tai nghe'),
    (e) => e.aiCode === 'AI_INVALID_RESPONSE'
  );
  values = Array(1536).fill(0);
  await assert.rejects(
    aiProvider.embed('tai nghe'),
    (e) => e.aiCode === 'AI_INVALID_RESPONSE'
  );
});

test('Gemini activation needs its own credential and an explicit application limit', () => {
  assert.throws(
    () =>
      validateAiEnvironment({
        AI_ENABLED: 'true',
        OPENAI_API_KEY: 'old-key',
        AI_DAILY_CALL_LIMIT: '100',
      }),
    /GEMINI_API_KEY/
  );
  assert.doesNotThrow(() =>
    validateAiEnvironment({
      AI_ENABLED: 'true',
      GEMINI_API_KEY: 'mock-only',
      AI_DAILY_CALL_LIMIT: '100',
    })
  );
});
