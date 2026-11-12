import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { aiProvider } from '../dist/services/ai/providers/provider.js';
import {
  environmentAiConfig,
  withAiRuntime,
} from '../dist/services/ai/config.js';
import { connectionInput } from '../dist/validations/ai/ai-settings.validation.js';
import { embeddingVersionInput } from '../dist/validations/ai/ai-embedding.validation.js';
import {
  compatibleVectorIndex,
  vectorDefinition,
  cosineSimilarity,
} from '../dist/services/ai/vector-infrastructure.js';

test('cosine ranking handles non-normalized vectors and rejects corrupt dimensions', () => {
  assert.equal(cosineSimilarity([2, 0], [7, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  for (const invalid of [[], [1], [0, 0], [NaN, 1], [Infinity, 1]])
    assert.equal(cosineSimilarity([1, 0], invalid), -Infinity);
});

const intent = {
  search: 'headphones',
  brand: null,
  category: null,
  minPrice: null,
  maxPrice: 500000,
  task: 'search',
  sort: 'price_asc',
  productNames: [],
  referencePositions: [],
  inherit: false,
};
for (const [provider, model, endpoint] of [
  [
    'gemini',
    'gemini-3.1-flash-lite',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ],
  ['openai', 'gpt-5.4-mini', 'https://api.openai.com/v1/chat/completions'],
  ['xai', 'grok-4.7', 'https://api.x.ai/v1/chat/completions'],
])
  test(`${provider} uses its own endpoint/key, strict JSON and streaming with no provider fallback`, async (t) => {
    t.mock.method(mongoose.Query.prototype, 'exec', async () => ({
      modifiedCount: 1,
    }));
    let fail = false;
    const requests = [];
    const network = t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(String(url), endpoint);
      assert.equal(
        new Headers(init.headers).get('authorization'),
        `Bearer ${provider}-credential`
      );
      const request = JSON.parse(init.body);
      requests.push(request);
      if (fail)
        return Response.json(
          { error: { message: 'quota', code: 'rate_limit_exceeded' } },
          { status: 429 }
        );
      if (!request.stream)
        return Response.json({
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { content: JSON.stringify(intent) },
            },
          ],
        });
      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [
              { index: 0, delta: { content: 'Hello' }, finish_reason: null },
            ],
          }) +
          '\n\ndata: ' +
          JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    });
    await withAiRuntime(
      {
        config: { ...environmentAiConfig(), enabled: true, provider, model },
        apiKey: `${provider}-credential`,
      },
      async () => {
        assert.deepEqual(
          await aiProvider.interpretQuery('headphones under 500k'),
          intent
        );
        let answer = '';
        for await (const delta of aiProvider.answerStream(
          'question',
          '{}',
          [],
          new AbortController().signal
        ))
          answer += delta;
        assert.equal(answer, 'Hello');
        assert.equal(requests[0].response_format.json_schema.strict, true);
        if (provider === 'openai') {
          assert.equal(requests[0].max_completion_tokens, 1536);
          assert.equal(requests[0].store, false);
        } else assert.equal(requests[0].max_tokens, 1536);
        if (provider === 'xai')
          assert.equal('reasoning_effort' in requests[0], false);
        fail = true;
        await assert.rejects(
          aiProvider.interpretQuery('q'),
          (error) => error.status === 429
        );
        assert.equal(network.mock.callCount(), 3);
        const before = network.mock.callCount();
        await assert.rejects(
          aiProvider.interpretQuery('q', AbortSignal.abort()),
          (error) => error.name === 'AbortError'
        );
        assert.equal(network.mock.callCount(), before);
      }
    );
  });

test('OpenAI embeddings use the embedding credential/dimensions independently from xAI chat', async (t) => {
  t.mock.method(mongoose.Query.prototype, 'exec', async () => ({
    modifiedCount: 1,
  }));
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/embeddings');
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer embedding-only-key'
    );
    assert.equal(JSON.parse(init.body).dimensions, 768);
    return Response.json({
      data: [{ embedding: [3, 4, ...Array(766).fill(0)] }],
    });
  });
  await withAiRuntime(
    {
      config: {
        ...environmentAiConfig(),
        enabled: true,
        provider: 'xai',
        model: 'grok-4.7',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 768,
      },
      apiKey: 'xai-chat-key',
      embeddingApiKey: 'embedding-only-key',
    },
    async () => {
      const vector = await aiProvider.embed('public source');
      assert.equal(vector.length, 768);
      assert.equal(vector[0], 0.6);
      assert.equal(vector[1], 0.8);
    }
  );
});

test('provider/model pairing and vector index definitions cannot mix embedding spaces', () => {
  const base = { revision: 0, name: 'Connection', apiKey: 'mock-api-key-long' };
  assert.ok(
    connectionInput.safeParse({
      ...base,
      provider: 'openai',
      model: 'gpt-4.1-mini',
    }).success
  );
  assert.ok(
    connectionInput.safeParse({ ...base, provider: 'xai', model: 'grok-4.7' })
      .success
  );
  assert.equal(
    connectionInput.safeParse({
      ...base,
      provider: 'openai',
      model: 'gemini-3.1-flash-lite',
    }).success,
    false
  );
  assert.equal(
    connectionInput.safeParse({
      ...base,
      provider: 'openai',
      model: 'gpt-image-1',
    }).success,
    false
  );
  assert.equal(
    embeddingVersionInput.safeParse({
      revision: 0,
      connectionId: '6c90df97-2427-4ef9-9fe0-61d04c68dd73',
      model: 'text-embedding-3-small',
      dimensions: 3072,
    }).success,
    false
  );
  assert.ok(
    compatibleVectorIndex({ latestDefinition: vectorDefinition(768) }, 768)
  );
  assert.equal(
    compatibleVectorIndex({ latestDefinition: vectorDefinition(768) }, 1536),
    false
  );
  assert.equal(
    compatibleVectorIndex(
      {
        latestDefinition: {
          fields: vectorDefinition(768).fields.filter(
            (f) => f.path !== 'generation'
          ),
        },
      },
      768
    ),
    false
  );
});
