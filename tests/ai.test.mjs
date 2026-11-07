import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY,
  HOUR,
  guestExpiry,
  messageExpiry,
} from '../dist/services/ai/config.js';
import { aiModels } from '../dist/models/ai/ai.model.js';
import {
  chatEventSchema,
  aiSearchSchema,
} from '../dist/validations/ai/ai.validation.js';
import { aiProvider } from '../dist/services/ai/providers/openai.provider.js';
import { validateAiEnvironment } from '../dist/services/ai/environment.js';
import { Permission } from '../dist/types/shared/permissions.type.js';
import { hasPermission } from '../dist/config/rolePermissions.js';
import { EventEmitter } from 'node:events';
import {
  httpAiTask,
  AI_HTTP_TIMEOUT_MS,
} from '../dist/services/ai/request-lifecycle.js';
test('guest retention starts at explicit completion or effective idle deadline', () => {
  const now = new Date('2026-11-07T00:00:00Z');
  assert.equal(guestExpiry(now).getTime(), now.getTime() + HOUR + DAY);
  const ended = new Date(now.getTime() + 12345);
  assert.equal(
    messageExpiry('guest', now, ended).getTime(),
    ended.getTime() + DAY
  );
  assert.equal(
    messageExpiry('customer', now, ended).getTime(),
    now.getTime() + 30 * DAY
  );
});
test('AI models declare snake_case collections and independent TTL indexes', () => {
  for (const model of aiModels)
    assert.match(model.schema.options.collection, /^ai_[a-z_]+$/);
  for (const name of [
    'AiConversation',
    'AiTurn',
    'AiSocketTicket',
    'AiCounter',
    'AiRiskEvent',
  ]) {
    const model = aiModels.find((m) => m.modelName === name);
    assert.ok(
      model.schema
        .indexes()
        .some(
          ([keys, options]) =>
            keys.expiresAt === 1 && options.expireAfterSeconds === 0
        )
    );
  }
});
test('socket input cannot supply owners, tools, database queries or oversized text', () => {
  const valid = {
    type: 'chat:send',
    conversationId: 'a'.repeat(24),
    requestId: crypto.randomUUID(),
    content: 'Tìm sản phẩm',
  };
  assert.equal(chatEventSchema.safeParse(valid).success, true);
  assert.equal(
    chatEventSchema.safeParse({ ...valid, ownerId: 'other' }).success,
    false
  );
  assert.equal(
    chatEventSchema.safeParse({ ...valid, content: 'x'.repeat(2001) }).success,
    false
  );
  assert.equal(
    aiSearchSchema.safeParse({ q: 'test', minPrice: 10, maxPrice: 1 }).success,
    false
  );
});
test('disabled provider rejects before any paid requests', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Must not call network');
  });
  const previous = process.env.AI_ENABLED;
  process.env.AI_ENABLED = 'false';
  try {
    await assert.rejects(
      aiProvider.embed('hello'),
      (error) => error.statusCode === 503
    );
  } finally {
    if (previous === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous;
  }
});
test('AI activation requires explicit credentials/budget; staff cannot administer AI', () => {
  assert.throws(
    () => validateAiEnvironment({ AI_ENABLED: 'true' }),
    /requires/
  );
  assert.throws(
    () => validateAiEnvironment({ AI_DAILY_CALL_LIMIT: '-1' }),
    /Invalid/
  );
  assert.throws(
    () => validateAiEnvironment({ AI_INDEX_ENABLED: 'true' }),
    /VECTOR_INDEX/
  );
  assert.equal(hasPermission('admin', Permission.AiManage), true);
  assert.equal(hasPermission('staff', Permission.AiManage), false);
});
test('HTTP disconnection aborts AI work and removes lifecycle listeners', async () => {
  const req = new EventEmitter();
  req.aborted = false;
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  let signal;
  const task = httpAiTask(req, res, async (s) => {
    signal = s;
    await new Promise((resolve) =>
      s.addEventListener('abort', resolve, { once: true })
    );
    s.throwIfAborted();
  });
  await Promise.resolve();
  res.destroyed = true;
  res.emit('close');
  await assert.rejects(task, (error) => error.name === 'AbortError');
  assert.equal(signal.aborted, true);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
  assert.ok(AI_HTTP_TIMEOUT_MS < 75000);
});
test('already-aborted AI calls never reach the provider or quota database', async (t) => {
  const calls = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected provider request');
  });
  const signal = AbortSignal.abort();
  await assert.rejects(
    aiProvider.embed('text', signal),
    (e) => e.name === 'AbortError'
  );
  await assert.rejects(
    aiProvider.interpretQuery('text', signal),
    (e) => e.name === 'AbortError'
  );
  assert.equal(calls.mock.callCount(), 0);
});
