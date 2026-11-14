import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Completions } from 'openai/resources/chat/completions';
import { aiProvider } from '../dist/services/ai/providers/provider.js';
import {
  withAiRuntime,
  environmentAiConfig,
  aiConfig,
  aiApiKey,
} from '../dist/services/ai/config.js';
import { environmentConnections } from '../dist/services/ai/provider-environment.js';
import {
  quotaCooldown,
  quotaFailure,
  nextDailyReset,
} from '../dist/services/ai/providers/quota.js';
const pool = [
  {
    id: 'gemini:0',
    provider: 'gemini',
    model: 'gemini-test',
    apiKey: 'gemini-secret',
    account: 'gemini-account',
  },
  {
    id: 'groq:0',
    provider: 'groq',
    model: 'llama-test',
    apiKey: 'groq-secret',
    account: 'groq-account',
  },
];
const intent = {
  search: 'phone',
  brand: null,
  category: null,
  minPrice: null,
  maxPrice: null,
};
function setup(t, connections = pool) {
  const states = new Map();
  t.mock.method(mongoose.Query.prototype, 'exec', async function () {
    if (this.model.modelName === 'AiProviderState') {
      const filter = this.getFilter();
      if (this.op === 'findOne')
        return filter._id.$in.some((k) => states.has(k))
          ? { _id: 'blocked' }
          : null;
      states.set(filter._id, this.getUpdate().$max.until);
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 1 };
  });
  const run = (work) =>
    withAiRuntime(
      {
        config: { ...environmentAiConfig(), enabled: true },
        apiKey: 'snapshot',
        connections,
      },
      work
    );
  return { run, states };
}
const event = (text, finish = null) => ({
  choices: [
    { index: 0, delta: text ? { content: text } : {}, finish_reason: finish },
  ],
});
async function read(signal = new AbortController().signal) {
  let text = '';
  for await (const delta of aiProvider.answerStream(
    'question',
    '{"products":[]}',
    [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ],
    signal
  ))
    text += delta;
  return text;
}
test('429 switches intent and stream to the next provider with the same history and request', async (t) => {
  const { run, states } = setup(t);
  const calls = [];
  t.mock.method(Completions.prototype, 'create', async function (body) {
    calls.push({ model: aiConfig().model, key: aiApiKey(), body });
    if (aiConfig().provider === 'gemini')
      throw Object.assign(new Error('rate limited'), {
        status: 429,
        headers: new Headers({ 'retry-after': '9' }),
      });
    if (!body.stream)
      return {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(intent) },
          },
        ],
      };
    return {
      async *[Symbol.asyncIterator]() {
        yield event('new answer');
        yield event('', 'stop');
      },
    };
  });
  await run(async () => {
    assert.deepEqual(await aiProvider.interpretQuery('question'), intent);
    assert.equal(await read(), 'new answer');
  });
  assert.deepEqual(
    calls.map((c) => c.model),
    ['gemini-test', 'llama-test', 'llama-test']
  );
  assert.equal(calls[1].key, 'groq-secret');
  assert.deepEqual(calls[2].body.messages.slice(1, 3), [
    { role: 'user', content: 'previous question' },
    { role: 'assistant', content: 'previous answer' },
  ]);
  assert.equal(states.size, 1);
});
test('stream quota after the first delta records cooldown but never concatenates another answer', async (t) => {
  const { run, states } = setup(t);
  let count = 0;
  let output = '';
  t.mock.method(Completions.prototype, 'create', async () => {
    count++;
    return {
      async *[Symbol.asyncIterator]() {
        yield event('partial');
        throw Object.assign(new Error('daily quota exceeded'), { status: 429 });
      },
    };
  });
  await run(async () =>
    assert.rejects(
      async () => {
        for await (const d of aiProvider.answerStream(
          'q',
          '{}',
          [],
          new AbortController().signal
        ))
          output += d;
      },
      (e) => e.status === 429
    )
  );
  assert.equal(output, 'partial');
  assert.equal(count, 1);
  assert.ok(states.has('account:gemini-account'));
});
test('application limits, invalid responses and aborts never trigger provider fallback', async (t) => {
  const { run } = setup(t);
  let count = 0;
  let error;
  t.mock.method(Completions.prototype, 'create', async () => {
    count++;
    throw error;
  });
  for (const e of [
    Object.assign(new Error('local cap'), {
      status: 429,
      aiCode: 'AI_USAGE_LIMIT',
    }),
    Object.assign(new Error('bad key'), { status: 401 }),
  ]) {
    error = e;
    const before = count;
    await run(() => assert.rejects(read(), (err) => err === e));
    assert.equal(count, before + 1);
  }
  const before = count;
  await run(() =>
    assert.rejects(read(AbortSignal.abort()), (e) => e.name === 'AbortError')
  );
  assert.equal(count, before);
});
test('all exhausted models fail once each without retry loops', async (t) => {
  const { run } = setup(t);
  let count = 0;
  t.mock.method(Completions.prototype, 'create', async () => {
    count++;
    throw Object.assign(new Error('429'), { status: 429 });
  });
  await run(() => assert.rejects(read(), (e) => e.status === 429));
  assert.equal(count, 2);
});
test('environment pool supports four providers, rejects paid OpenRouter and never returns DB credentials', () => {
  const env = {
    GEMINI_API_KEY: 'g',
    GROQ_API_KEY: 'r',
    GROQ_CHAT_MODELS: 'llama-test',
    OPENROUTER_API_KEY: 'o',
    OPENROUTER_CHAT_MODELS: 'openrouter/free',
    CLOUDFLARE_API_KEY: 'c',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_CHAT_MODELS: '@cf/meta/llama-3.1-8b-instruct',
  };
  assert.deepEqual(
    environmentConnections(env).map((c) => c.provider),
    ['gemini', 'groq', 'openrouter', 'cloudflare']
  );
  assert.throws(() =>
    environmentConnections({
      ...env,
      OPENROUTER_CHAT_MODELS: 'openai/paid-model',
    })
  );
});
test('quota classification separates local caps, minute limits and daily limits; honors retry-after', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  assert.equal(quotaFailure({ status: 429, aiCode: 'AI_USAGE_LIMIT' }), false);
  assert.equal(quotaFailure({ status: 429 }), true);
  assert.equal(
    quotaCooldown(
      { status: 429, headers: new Headers({ 'retry-after': '12' }) },
      now
    ).until.getTime() - now.getTime(),
    12000
  );
  assert.equal(
    quotaCooldown({ status: 429, message: 'daily quota exceeded' }, now).reason,
    'daily'
  );
  assert.equal(quotaCooldown({ status: 429 }, now).reason, 'rate');
});

test('daily reset honors Pacific DST for Gemini and UTC for Cloudflare', () => {
  assert.equal(
    nextDailyReset('gemini', new Date('2026-11-01T07:30:00Z')).toISOString(),
    '2026-11-02T08:00:00.000Z'
  );
  assert.equal(
    nextDailyReset('gemini', new Date('2026-03-08T08:30:00Z')).toISOString(),
    '2026-03-09T07:00:00.000Z'
  );
  assert.equal(
    nextDailyReset(
      'cloudflare',
      new Date('2026-11-14T10:30:00Z')
    ).toISOString(),
    '2026-11-15T00:00:00.000Z'
  );
});

test('API keys alone enable every provider with backend defaults; model overrides remain optional', () => {
  const env = {
    GEMINI_API_KEY: 'g',
    GROQ_API_KEY: 'r',
    OPENROUTER_API_KEY: 'o',
    CLOUDFLARE_API_KEY: 'c',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  };
  const pool = environmentConnections(env);
  assert.deepEqual(
    pool.map((c) => c.provider),
    ['gemini', 'groq', 'openrouter', 'cloudflare']
  );
  assert.deepEqual(
    pool.map((c) => c.model),
    [
      'gemini-3.1-flash-lite',
      'llama-3.3-70b-versatile',
      'openrouter/free',
      '@cf/meta/llama-3.1-8b-instruct',
    ]
  );
  assert.equal(
    environmentConnections({ ...env, GROQ_CHAT_MODELS: 'llama-override' }).find(
      (c) => c.provider === 'groq'
    ).model,
    'llama-override'
  );
  assert.equal('dailyLimit' in pool[0], false);
  assert.equal('dailyCalls' in environmentAiConfig(), false);
});

test('admin inventory lists all providers but runtime includes only fully configured enabled providers', async () => {
  const { environmentRoutingInventory } =
    await import('../dist/services/ai/provider-environment.js');
  const env = {
    GEMINI_API_KEY: 'secret-only',
    CLOUDFLARE_API_KEY: 'another-secret',
    GROQ_API_KEY: 'excluded-secret',
    AI_PROVIDER_ORDER: 'gemini,openrouter,cloudflare',
  };
  const rows = environmentRoutingInventory(env);
  assert.equal(rows.length, 4);
  assert.equal(rows.find((r) => r.provider === 'gemini').priority, 1);
  assert.equal(rows.find((r) => r.provider === 'groq').state, 'excluded');
  assert.equal(
    rows.find((r) => r.provider === 'cloudflare').state,
    'missing_account'
  );
  assert.equal(
    rows.find((r) => r.provider === 'openrouter').state,
    'missing_key'
  );
  assert.deepEqual(
    environmentConnections(env).map((c) => c.provider),
    ['gemini']
  );
  assert.ok(!JSON.stringify(rows).includes('secret'));
  assert.equal(environmentRoutingInventory({}).length, 4);
});

test('catalog reads all model lists from the supplied environment, trims duplicates and keeps defaults', async () => {
  const { getProviderModels, providerModels } =
    await import('../dist/services/ai/providers/catalog.js');
  const models = getProviderModels({
    GEMINI_CHAT_MODELS: ' gemini-a, gemini-b,gemini-a ',
    GROQ_CHAT_MODELS: 'llama-a',
    OPENROUTER_CHAT_MODELS: 'vendor/model:free',
    CLOUDFLARE_CHAT_MODELS: '@cf/vendor/model',
  });
  assert.deepEqual(models.gemini, ['gemini-a', 'gemini-b']);
  assert.deepEqual(models.groq, ['llama-a']);
  assert.deepEqual(models.openrouter, ['vendor/model:free']);
  assert.deepEqual(models.cloudflare, ['@cf/vendor/model']);
  assert.deepEqual(getProviderModels({ GROQ_CHAT_MODELS: ' , ' }).groq, [
    'llama-3.3-70b-versatile',
  ]);
  assert.deepEqual(
    getProviderModels({ AI_CHAT_MODEL: 'gemini-legacy' }).gemini,
    ['gemini-legacy']
  );
  const old = process.env.GROQ_CHAT_MODELS;
  try {
    process.env.GROQ_CHAT_MODELS = 'late-model';
    assert.deepEqual(providerModels.groq, ['late-model']);
  } finally {
    if (old === undefined) delete process.env.GROQ_CHAT_MODELS;
    else process.env.GROQ_CHAT_MODELS = old;
  }
});
