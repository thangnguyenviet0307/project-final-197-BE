import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  encryptCredential,
  decryptCredential,
  credentialsReady,
} from '../dist/services/ai/credentials.js';
import {
  aiConfig,
  aiApiKey,
  environmentAiConfig,
  withAiRuntime,
} from '../dist/services/ai/config.js';
import { settingsInput } from '../dist/validations/ai/ai-settings.validation.js';

test('API keys are authenticated, randomized ciphertext bound to the connection identity', (t) => {
  const previous = process.env.AI_CONFIG_ENCRYPTION_KEY;
  process.env.AI_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  t.after(() => {
    if (previous === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    else process.env.AI_CONFIG_ENCRYPTION_KEY = previous;
  });
  const plain = 'secret-gemini-key-never-logged';
  const first = encryptCredential(plain, 'connection-a');
  assert.notEqual(first, encryptCredential(plain, 'connection-a'));
  assert.ok(!first.includes(plain));
  assert.equal(decryptCredential(first, 'connection-a'), plain);
  assert.throws(
    () => decryptCredential(first, 'connection-b'),
    (e) => e.statusCode === 503
  );
  assert.throws(
    () => decryptCredential(first.slice(0, -5), 'connection-a'),
    (e) => e.statusCode === 503
  );
  process.env.AI_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  assert.throws(
    () => decryptCredential(first, 'connection-a'),
    (e) => e.statusCode === 503
  );
  delete process.env.AI_CONFIG_ENCRYPTION_KEY;
  assert.equal(credentialsReady(), false);
  assert.throws(
    () => encryptCredential(plain, 'id'),
    (e) => e.statusCode === 503
  );
});

test('concurrent AI operations retain their own model/key snapshot and never expose credentials in config', async () => {
  const release = Promise.withResolvers();
  const base = environmentAiConfig();
  const one = withAiRuntime(
    {
      config: { ...base, model: 'gemini-one', revision: 1 },
      apiKey: 'one-secret',
    },
    async () => {
      await release.promise;
      assert.equal(aiConfig().model, 'gemini-one');
      assert.equal(aiApiKey(), 'one-secret');
      assert.ok(!JSON.stringify(aiConfig()).includes('secret'));
    }
  );
  await withAiRuntime(
    {
      config: { ...base, model: 'gemini-two', revision: 2 },
      apiKey: 'two-secret',
    },
    async () => {
      assert.equal(aiConfig().model, 'gemini-two');
      assert.equal(aiApiKey(), 'two-secret');
      release.resolve();
    }
  );
  await one;
  assert.equal(aiConfig().model, base.model);
});

test('management validation rejects unsupported providers, URLs, key removal, unknown fields and invalid limits', () => {
  const flags = {
    revision: 0,
    enabled: false,
    semanticEnabled: false,
    indexingEnabled: false,
    riskEnabled: false,
  };
  assert.equal(settingsInput.safeParse(flags).success, true);
  for (const extra of [
    { apiKey: 'do-not-save' },
    { activeConnectionId: null },
    { provider: 'openai' },
  ])
    assert.equal(
      settingsInput.safeParse({ ...flags, ...extra }).success,
      false
    );
  assert.equal(
    settingsInput.safeParse({ ...flags, dailyCalls: 100 }).success,
    false
  );
  assert.equal(
    settingsInput.safeParse({ ...flags, enabled: 'true' }).success,
    false
  );
});

test('activation requires explicit confirmation and a revision, without client credentials', async () => {
  const { activationInput } =
    await import('../dist/validations/ai/ai-settings.validation.js');
  assert.equal(
    activationInput.safeParse({ revision: 0, confirm: true }).success,
    true
  );
  for (const input of [
    { revision: 0 },
    { revision: 0, confirm: false },
    { revision: 0, confirm: true, apiKey: 'secret' },
  ])
    assert.equal(activationInput.safeParse(input).success, false);
});
