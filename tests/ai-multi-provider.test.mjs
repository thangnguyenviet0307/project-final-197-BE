import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { aiProvider } from '../dist/services/ai/providers/provider.js';
import {
  environmentAiConfig,
  withAiRuntime,
} from '../dist/services/ai/config.js';
import { compatibleChatModel } from '../dist/services/ai/providers/catalog.js';
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
  [
    'groq',
    'llama-3.3-70b-versatile',
    'https://api.groq.com/openai/v1/chat/completions',
  ],
  [
    'openrouter',
    'openrouter/free',
    'https://openrouter.ai/api/v1/chat/completions',
  ],
  [
    'cloudflare',
    '@cf/meta/llama-3.1-8b-instruct',
    'https://api.cloudflare.com/client/v4/accounts/' +
      'a'.repeat(32) +
      '/ai/v1/chat/completions',
  ],
])
  test(`${provider} uses its own endpoint/key, strict JSON and streaming with no provider fallback`, async (t) => {
    t.mock.method(mongoose.Query.prototype, 'exec', async function () {
      return this.model.modelName === 'AiProviderState' && this.op === 'findOne'
        ? null
        : { modifiedCount: 1 };
    });
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
        cloudflareAccountId: 'a'.repeat(32),
        connections: [
          {
            id: provider,
            provider,
            model,
            apiKey: `${provider}-credential`,
            account: provider,
          },
        ],
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
        assert.equal(
          requests[0].response_format.type,
          provider === 'gemini' ? 'json_schema' : 'json_object'
        );
        assert.equal(requests[0].max_tokens, 1536);
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

test('provider/model pairing and vector index definitions cannot mix embedding spaces', () => {
  assert.equal(compatibleChatModel('openrouter', 'openai/gpt-paid'), false);
  assert.equal(compatibleChatModel('openrouter', 'openrouter/free'), true);
  assert.equal(
    embeddingVersionInput.safeParse({
      revision: 0,
      connectionId: '6c90df97-2427-4ef9-9fe0-61d04c68dd73',
      model: 'text-embedding-3-small',
      dimensions: 1536,
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
