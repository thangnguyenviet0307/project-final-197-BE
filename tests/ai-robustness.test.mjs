import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { Completions } from 'openai/resources/chat/completions';
import { cachedAiValue, clearAiCache } from '../dist/services/ai/cache.js';
import { aiProvider } from '../dist/services/ai/providers/gemini.provider.js';
import {
  httpAiTask,
  AI_HTTP_TIMEOUT_MS,
} from '../dist/services/ai/request-lifecycle.js';

test('one cancelled cache subscriber cannot abort the other subscribers', async (t) => {
  clearAiCache();
  t.after(clearAiCache);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0,
    shared;
  const compute = async (signal) => {
    calls++;
    shared = signal;
    await gate;
    signal.throwIfAborted();
    return 'shared-result';
  };
  const a = new AbortController(),
    b = new AbortController();
  const first = cachedAiValue('shared', compute, a.signal);
  const second = cachedAiValue('shared', compute, b.signal);
  const more = Array.from({ length: 8 }, () =>
    cachedAiValue('shared', compute)
  );
  const rejected = assert.rejects(first, (e) => e.name === 'AbortError');
  await Promise.resolve();
  a.abort();
  await rejected;
  assert.equal(calls, 1);
  assert.equal(shared.aborted, false);
  release();
  assert.deepEqual(
    await Promise.all([second, ...more]),
    Array(9).fill('shared-result')
  );
  assert.equal(await cachedAiValue('shared', compute), 'shared-result');
  assert.equal(calls, 1);
});
test('last subscriber cancellation aborts work and late results cannot overwrite a new flight', async (t) => {
  clearAiCache();
  t.after(clearAiCache);
  let release, shared;
  const controller = new AbortController();
  const old = cachedAiValue(
    'replace',
    async (signal) => {
      shared = signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    controller.signal
  );
  const rejected = assert.rejects(old, (e) => e.name === 'AbortError');
  await Promise.resolve();
  controller.abort();
  await rejected;
  assert.equal(shared.aborted, true);
  assert.equal(await cachedAiValue('replace', async () => 'new'), 'new');
  release('stale');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    await cachedAiValue('replace', async () => 'must-not-run'),
    'new'
  );
});
test('failed cache computations are evicted and can be retried', async (t) => {
  clearAiCache();
  t.after(clearAiCache);
  await assert.rejects(
    cachedAiValue('failure', async () => {
      throw new Error('upstream');
    }),
    /upstream/
  );
  assert.equal(
    await cachedAiValue('failure', async () => 'recovered'),
    'recovered'
  );
});
test('HTTP deadline rejects promptly even when database work ignores cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const req = new EventEmitter();
  req.aborted = false;
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;
  let finish, signal;
  const task = httpAiTask(req, res, async (s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const rejected = assert.rejects(task, (e) => e.statusCode === 504);
  await Promise.resolve();
  t.mock.timers.tick(AI_HTTP_TIMEOUT_MS);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
  finish('late-success');
  await Promise.resolve();
  await Promise.resolve();
});
test('provider requires a completed terminal event and propagates upstream failures', async (t) => {
  const previous = {
    enabled: process.env.AI_ENABLED,
    key: process.env.GEMINI_API_KEY,
  };
  process.env.AI_ENABLED = 'true';
  process.env.GEMINI_API_KEY = 'mock-only';
  t.after(() => {
    if (previous.enabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous.enabled;
    if (previous.key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.key;
  });
  t.mock.method(mongoose.Query.prototype, 'exec', async () => ({
    modifiedCount: 1,
  }));
  let events = [];
  const requests = [];
  t.mock.method(Completions.prototype, 'create', async (request) => {
    requests.push(request);
    return {
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    };
  });
  const read = async () => {
    let text = '';
    for await (const delta of aiProvider.answerStream(
      'q',
      'context',
      [],
      new AbortController().signal
    ))
      text += delta;
    return text;
  };
  const delta = {
    choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }],
  };
  events = [delta];
  await assert.rejects(read(), (e) => e.aiCode === 'AI_INVALID_RESPONSE');
  for (const reason of ['length', 'content_filter', 'tool_calls']) {
    events = [
      delta,
      { choices: [{ index: 0, delta: {}, finish_reason: reason }] },
    ];
    await assert.rejects(
      read(),
      (e) =>
        e.aiCode ===
        (reason === 'length' ? 'AI_OUTPUT_LIMIT' : 'AI_INVALID_RESPONSE')
    );
  }
  events = [
    delta,
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  assert.equal(await read(), 'partial');
  const request = requests.at(-1);
  assert.ok(request.max_tokens >= 2048);
  assert.match(request.messages[0].content, /verifiedStoreData/);
  assert.match(request.messages[0].content, /catalogScope/);
  assert.equal(request.reasoning_effort, 'low');
  assert.equal('store' in request, false);
});
