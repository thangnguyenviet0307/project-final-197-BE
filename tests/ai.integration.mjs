import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';
import {
  AiConversation,
  AiTurn,
  aiModels,
} from '../dist/models/ai/ai.model.js';
import * as chat from '../dist/services/ai/conversation.service.js';
import { DAY, HOUR } from '../dist/services/ai/config.js';
import { attachAiGateway } from '../dist/gateways/ai/chat.gateway.js';
import { aiProvider } from '../dist/services/ai/providers/gemini.provider.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import Product from '../dist/models/products/products.model.js';
import { BrandModel } from '../dist/models/brands/brands.model.js';
import { Categories } from '../dist/models/categories/categories.model.js';
import { AiChunk } from '../dist/models/ai/ai.model.js';
import { searchProducts } from '../dist/services/ai/retrieval.service.js';
import { retrieveKnowledge } from '../dist/services/ai/retrieval.service.js';
import {
  indexSource,
  pruneHiddenProductChunks,
  startAiIndexWorker,
} from '../dist/services/ai/knowledge-index.service.js';
import { runChat } from '../dist/services/ai/chat.service.js';
import { clearAiCache } from '../dist/services/ai/cache.js';
import {
  AiIndexJob,
  AiRiskEvent,
  AiCounter,
} from '../dist/models/ai/ai.model.js';
import {
  reserveUsage,
  reserveProviderCall,
} from '../dist/services/ai/usage.service.js';
import { observeRisk } from '../dist/services/ai/risk.service.js';
import { digest } from '../dist/services/ai/identity.service.js';
import { EventEmitter } from 'node:events';
import { generateAccessToken } from '../dist/utils/auth/token.js';
import { AiSettings } from '../dist/models/ai/ai-settings.model.js';
import * as management from '../dist/services/ai/settings.service.js';
import { resolveAiRuntime, withAiRuntime, aiConfig, aiApiKey, environmentAiConfig } from '../dist/services/ai/config.js';
import { User } from '../dist/models/users/users.model.js';
import { AiEmbeddingChunk, AiEmbeddingGeneration } from '../dist/models/ai/ai-embedding.model.js';
import { createEmbeddingVersion, activateEmbeddingVersion, changeEmbeddingVersion, readEmbeddingVersions } from '../dist/services/ai/embedding-versions.service.js';
import { runEmbeddingBuild, queueActiveEmbeddingRefresh } from '../dist/services/ai/embedding-worker.js';
import { vectorInfrastructure, VectorIndexPending } from '../dist/services/ai/vector-infrastructure.js';
import { knowledgeSourceProvider } from '../dist/services/ai/knowledge-sources.js';
import { withAiConfig, aiEmbeddingKey } from '../dist/services/ai/config.js';
import { encryptCredential } from '../dist/services/ai/credentials.js';
import { vectorMatches } from '../dist/services/ai/retrieval.service.js';
const originalAIProvider = { ...aiProvider };
const originalVectorInfrastructure = { ...vectorInfrastructure };
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
process.env.AI_ENABLED = 'false';
const { default: app } = await import('../dist/app.js');
const uri = process.env.MONGODB_TEST_URI;
if (!uri || !uri.startsWith('mongodb://127.0.0.1:'))
  throw new Error('Requires isolated loopback test deployment');
let server, stop, base;
const guest = { kind: 'guest', id: randomUUID() };

test('iPhone cases in a shared-unit budget match live catalog aliases without semantic search', async (t) => {
  clearAiCache();
  const brand = await BrandModel.create({ name: 'Case fixture Apple', slug: 'case-fixture-apple' });
  const category = await Categories.create({ name: 'Ốp điện thoại', slug: 'case-fixture-category' });
  const base = { category: category._id, brand: brand._id, stock: 5, is_active: true };
  const fixtures = await Product.insertMany([
    { ...base, product_name: 'Ốp lưng iPhone 15 Pro/Pro max dodocase', slug: 'case-fixture-15', price: 166000 },
    { ...base, product_name: 'Ốp lưng iPhone 17/18 kuroma', slug: 'case-fixture-17', price: 157000 },
    { ...base, product_name: 'Ốp lưng Samsung S25', slug: 'case-fixture-samsung', price: 150000 },
    { ...base, product_name: 'Ốp lưng iPhone đắt', slug: 'case-fixture-high', price: 250000 },
    { ...base, product_name: 'Ốp lưng iPhone ẩn', slug: 'case-fixture-hidden', price: 150000, on_sale: false },
  ]);
  t.mock.method(aiProvider, 'interpretQuery', async () => ({ search: 'iphone op lung', brand: 'iPhone', category: 'ốp lưng', minPrice: 100, maxPrice: 200 }));
  const runtime = { config: { ...environmentAiConfig(), enabled: true, semanticEnabled: false }, apiKey: 'mock-only' };
  const result = await withAiRuntime(runtime, () => searchProducts({ q: 'tôi muốn tìm ốp lưng iphone với giá tầm 100-200k', page: 1, limit: 10 }));
  assert.deepEqual(new Set(result.rows.map((p) => p.id)), new Set(fixtures.slice(0, 2).map((p) => String(p._id))));
  assert.equal(result.searchContext.minPrice, 100000);
  assert.equal(result.searchContext.maxPrice, 200000);
  const sorted = await withAiRuntime(runtime, () => searchProducts({ q: 'op lung iphone 100-200k gia tang dan', page: 1, limit: 10 }));
  assert.deepEqual(sorted.rows.map((p) => p.price), [157000, 166000]);
  clearAiCache();
});

test('catalog extrema sort all eligible products by live discounted variant price, not the newest 100', async (t) => {
  clearAiCache();
  process.env.AI_ENABLED = 'true'; process.env.GEMINI_API_KEY = 'mock-only';
  t.after(() => { process.env.AI_ENABLED = 'false'; delete process.env.GEMINI_API_KEY; clearAiCache(); });
  const brand = await BrandModel.create({ name: 'Extrema Brand', slug: 'extrema-brand' });
  const category = await Categories.create({ name: 'Extrema Category', slug: 'extrema-category' });
  const baseProduct = { category: category._id, brand: brand._id, stock: 5, is_active: true };
  const cheapest = await Product.create({ ...baseProduct, product_name: 'Extrema oldest', slug: 'extrema-oldest', price: 999999, discount: 50, variants: [{ sku: 'EXT-OLD', price: 1000, stock: 5 }] });
  await Product.insertMany(Array.from({ length: 105 }, (_, i) => ({ ...baseProduct, product_name: `Extrema ${i}`, slug: `extrema-${i}`, price: 10000 + i })));
  await Product.create({ ...baseProduct, product_name: 'Extrema hidden', slug: 'extrema-hidden', price: 1, on_sale: false });
  t.mock.method(aiProvider, 'interpretQuery', async () => ({ search: '', brand: null, category: null, minPrice: null, maxPrice: null, sort: 'price_asc' }));
  const result = await searchProducts({ q: 'Giá thấp nhất trong cửa hàng', brand: String(brand._id), page: 1, limit: 6 });
  assert.equal(result.scope, 'catalog');
  assert.equal(result.total, 106);
  assert.equal(result.rows[0].id, String(cheapest._id));
  assert.equal(result.rows[0].price, 500);
  t.mock.method(aiProvider, 'interpretQuery', async () => ({ search: '', brand: null, category: null, minPrice: null, maxPrice: null, sort: 'price_desc' }));
  const high = await searchProducts({ q: 'Giá cao nhất trong cửa hàng', brand: String(brand._id), page: 1, limit: 1 });
  assert.equal(high.rows[0].price, 10104);
});

test('follow-up keeps structured filters, reads the full question and never substitutes hidden ordinal products', async (t) => {
  clearAiCache(); process.env.AI_ENABLED = 'true'; process.env.GEMINI_API_KEY = 'mock-only';
  t.after(() => { process.env.AI_ENABLED = 'false'; delete process.env.GEMINI_API_KEY; clearAiCache(); });
  const brand = await BrandModel.create({ name: 'Followup Brand', slug: 'followup-brand' });
  const category = await Categories.create({ name: 'Followup Category', slug: 'followup-category' });
  const fixtures = await Product.insertMany([10000, 10001, 20000].map((price, i) => ({ product_name: `Followup ${i}`, slug: `followup-${i}`, brand: brand._id, category: category._id, stock: 1, price, is_active: true })));
  const previousSearch = { q: '', brand: String(brand._id), minPrice: 10000, page: 1, limit: 6 };
  const question = 'Tôi muốn tìm thêm sản phẩm. '.repeat(35) + 'Ngân sách tối đa 10001 đồng.';
  let seen;
  t.mock.method(aiProvider, 'interpretQuery', async (q, _signal, context) => { seen = { q, context }; return { search: '', brand: null, category: null, minPrice: null, maxPrice: 10001, inherit: true }; });
  const result = await retrieveKnowledge(question, undefined, { previousSearch });
  assert.equal(seen.q, question);
  assert.equal(seen.context.previousSearch.brand, previousSearch.brand);
  assert.equal(result.searchContext.maxPrice, 10001);
  assert.ok(result.products.length > 0);
  assert.ok(result.products.every((p) => p.price >= 10000 && p.price <= 10001));
  t.mock.method(aiProvider, 'interpretQuery', async () => ({ search: '', brand: null, category: null, minPrice: null, maxPrice: null, referencePositions: [2] }));
  const missing = await retrieveKnowledge('Cái thứ hai thì sao?', undefined, { previousProductIds: ['a', 'b'], previousProducts: [] });
  assert.equal(missing.products.length, 0);
  assert.match(missing.clarification, /không còn khả dụng/);
  t.mock.method(aiProvider, 'interpretQuery', async () => ({ search: '', brand: null, category: null, minPrice: null, maxPrice: null, task: 'compare', productNames: ['Followup 0', 'Followup 2'] }));
  const comparison = await retrieveKnowledge('So sánh Followup 0 và Followup 2', undefined, {});
  assert.deepEqual(new Set(comparison.products.map((p) => p.id)), new Set([String(fixtures[0]._id), String(fixtures[2]._id)]));
  assert.equal(comparison.clarification, undefined);
});

test('quick prompts clarify without paid generation and quota failures persist safe feedback for replay', async (t) => {
  clearAiCache(); process.env.AI_ENABLED = 'true'; process.env.GEMINI_API_KEY = 'mock-only';
  t.after(() => { process.env.AI_ENABLED = 'false'; delete process.env.GEMINI_API_KEY; clearAiCache(); });
  const answer = t.mock.method(aiProvider, 'answerStream', async function* () { throw new Error('Unexpected paid generation'); });
  t.mock.method(aiProvider, 'interpretQuery', async () => { throw Object.assign(new Error('secret-provider-payload'), { status: 429, code: 'insufficient_quota' }); });
  const owner = { kind: 'guest', id: randomUUID() };
  const c = await chat.createConversation(owner);
  const events = [];
  await runChat(owner, { conversationId: String(c._id), requestId: randomUUID(), content: 'So sánh sản phẩm' }, new AbortController().signal, (e) => events.push(e));
  assert.equal(events.at(-1).type, 'chat:completed');
  assert.match(events.at(-1).data.answer, /ít nhất hai/);
  assert.equal(answer.mock.callCount(), 0);
  const input = { conversationId: String(c._id), requestId: randomUUID(), content: 'Tìm tai nghe dưới 800 nghìn' };
  await runChat(owner, input, new AbortController().signal, (e) => events.push(e));
  assert.equal(events.at(-1).data.code, 'AI_CREDIT_EXHAUSTED');
  const saved = await AiTurn.findOne({ requestId: input.requestId }).lean();
  assert.equal(saved.status, 'failed');
  assert.equal(saved.error.code, 'AI_CREDIT_EXHAUSTED');
  assert.ok(!JSON.stringify(saved).includes('secret-provider-payload'));
  await runChat(owner, input, new AbortController().signal, (e) => events.push(e));
  assert.equal(events.at(-1).data.message, saved.error.message);
  assert.equal(answer.mock.callCount(), 0);
});
before(async () => {
  await mongoose.connect(uri, {
    dbName: 'ai_test_' + randomBytes(10).toString('hex'),
  });
  for (const model of aiModels) await model.init();
  server = app.listen(0, '127.0.0.1');
  stop = attachAiGateway(server);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/v1/ai`;
});
after(async () => {
  stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  // Only this suite's random, isolated test database is removed.
  assert.match(mongoose.connection.name, /^ai_test_[a-f0-9]{20}$/);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
test('disabled AI explains availability safely instead of reporting an ambiguous incomplete answer', async (t) => {
  const previous = process.env.AI_ENABLED;
  process.env.AI_ENABLED = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous;
  });
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected paid network request'); });
  const owner = { kind: 'guest', id: randomUUID() };
  const c = await chat.createConversation(owner);
  const events = [];
  await runChat(owner, { conversationId: String(c._id), requestId: randomUUID(), content: 'Tìm tai nghe dưới 500 nghìn' },
    new AbortController().signal, event => events.push(event));
  assert.equal(events.at(-1).type, 'chat:error');
  assert.equal(events.at(-1).data.status, 'failed');
  assert.equal(events.at(-1).data.message, 'Trợ lý AI hiện chưa sẵn sàng. Bạn có thể tìm sản phẩm trong cửa hàng và quay lại sau.');
  assert.equal(network.mock.callCount(), 0);
});

test('durable cancellation survives delayed sends, rejects other owners and keeps terminal results immutable', async () => {
  const owner = { kind: 'guest', id: randomUUID() };
  const c = await chat.createConversation(owner);
  const id = String(c._id);
  const requestId = randomUUID();
  await assert.rejects(chat.cancelTurn(id, guest, requestId, 'cancel me'), e => e.statusCode === 404);
  assert.equal((await chat.cancelTurn(id, owner, requestId, 'cancel me')).status, 'cancelled');
  const delayed = await chat.beginTurn(id, owner, requestId, 'cancel me');
  assert.equal(delayed.replay, true);
  assert.equal(delayed.turn.status, 'cancelled');
  await assert.rejects(chat.cancelTurn(id, owner, requestId, 'different'), e => e.statusCode === 409);
  assert.equal((await AiTurn.updateOne({ _id: delayed.turn._id, status: 'processing' }, { $set: { status: 'completed' } })).modifiedCount, 0);
  const completedId = randomUUID();
  const completed = await chat.beginTurn(id, owner, completedId, 'done');
  await AiTurn.updateOne({ _id: completed.turn._id, status: 'processing' }, { $set: { status: 'completed', answer: 'saved answer' } });
  const result = await chat.cancelTurn(id, owner, completedId, 'done');
  assert.equal(result.status, 'completed');
  assert.equal(result.answer, 'saved answer');
  assert.equal((await chat.cancelTurn(id, owner, completedId, 'done')).status, 'completed');
});

test('HTTP cancellation validates origin, identity, payload and confirms the matching request', async () => {
  const post = (path, cookie, body = {}, origin = 'http://localhost:5173') => fetch(base + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const session = await post('/session');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const conversation = (await (await post('/conversations', cookie)).json()).data.id;
  const path = `/conversations/${conversation}/cancel`;
  const body = { requestId: randomUUID(), content: 'cancel through HTTP' };
  assert.equal((await post(path, null, body)).status, 428);
  assert.equal((await post(path, cookie, body, 'https://untrusted.example')).status, 403);
  assert.equal((await post(path, cookie, { requestId: body.requestId })).status, 400);
  const otherSession = await post('/session');
  const otherCookie = otherSession.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(path, otherCookie, body)).status, 404);
  const response = await post(path, cookie, body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { requestId: body.requestId, status: 'cancelled', answer: '', sources: [] });
});

test('concurrent cancellation and completion choose exactly one immutable terminal result', async () => {
  const c = await chat.createConversation(guest);
  for (let i = 0; i < 8; i++) {
    const requestId = randomUUID();
    // A separate DB write competes with the cancel transaction, as on another instance.
    const { turn } = await chat.beginTurn(String(c._id), guest, requestId, 'race');
    const [cancelled, completed] = await Promise.all([
      chat.cancelTurn(String(c._id), guest, requestId, 'race'),
      AiTurn.updateOne({ _id: turn._id, status: 'processing' }, { $set: { status: 'completed', answer: 'winner' } }),
    ]);
    const saved = await AiTurn.findById(turn._id);
    assert.equal(saved.status, completed.modifiedCount ? 'completed' : 'cancelled');
    assert.equal(cancelled.status, saved.status);
    assert.equal((await chat.cancelTurn(String(c._id), guest, requestId, 'race')).status, saved.status);
    // A completed worker normally releases the conversation lock in finally.
    await AiConversation.updateOne({ _id: c._id, activeRequestId: requestId }, { $set: { activeRequestId: null, busyUntil: null } });
  }
});

test('replay distinguishes processing/completed/cancelled/failed without starting another provider call', async (t) => {
  const answer = t.mock.method(aiProvider, 'answerStream', async function* () { throw new Error('Unexpected paid generation'); });
  for (const status of ['processing', 'completed', 'cancelled', 'failed']) {
    const owner = { kind: 'guest', id: randomUUID() };
    const c = await chat.createConversation(owner);
    const input = { conversationId: String(c._id), requestId: randomUUID(), content: 'replay' };
    const { turn } = await chat.beginTurn(input.conversationId, owner, input.requestId, input.content);
    await AiTurn.updateOne({ _id: turn._id }, { $set: { status, answer: status === 'completed' ? 'saved' : '' } });
    const events = [];
    await runChat(owner, input, new AbortController().signal, e => events.push(e));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, status === 'processing' ? 'chat:processing' : status === 'completed' ? 'chat:completed' : 'chat:error');
    assert.equal(events[0].data.status, status);
  }
  assert.equal(answer.mock.callCount(), 0);
});

test('cancellation during the final database check cannot complete the turn', async (t) => {
  const owner = { kind: 'guest', id: randomUUID() };
  const c = await chat.createConversation(owner);
  const input = { conversationId: String(c._id), requestId: randomUUID(), content: 'final check' };
  const controller = new AbortController();
  t.mock.method(aiProvider, 'answerStream', async function* () { yield 'answer'; });
  const original = AiConversation.exists;
  t.mock.method(AiConversation, 'exists', async function(filter) {
    const result = await original.call(this, filter);
    controller.abort();
    return result;
  });
  const events = [];
  await runChat(owner, input, controller.signal, e => events.push(e));
  assert.equal((await AiTurn.findOne({ conversationId: c._id, requestId: input.requestId })).status, 'cancelled');
  assert.equal(events.some(e => e.type === 'chat:completed'), false);
});

test('a remote cancellation in DB stops generation even without an in-process abort', async (t) => {
  const owner = { kind: 'guest', id: randomUUID() };
  const c = await chat.createConversation(owner);
  const input = { conversationId: String(c._id), requestId: randomUUID(), content: 'remote cancellation' };
  let started;
  const first = new Promise(resolve => { started = resolve; });
  t.mock.method(aiProvider, 'answerStream', async function* (_a, _b, _c, signal) {
    yield 'partial';
    await new Promise(resolve => {
      started();
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    signal.throwIfAborted();
  });
  const events = [];
  const running = runChat(owner, input, AbortSignal.timeout(5000), e => events.push(e));
  await first;
  await AiTurn.updateOne({ conversationId: c._id, requestId: input.requestId, status: 'processing' }, { $set: { status: 'cancelled' } });
  await running;
  assert.equal(events.some(e => e.type === 'chat:completed'), false);
  assert.equal(events.at(-1).data.status, 'cancelled');
});

test('ending guest chat is idempotent, closes sends and gives all messages 24h from completion', async () => {
  const now = new Date();
  const c = await chat.createConversation(guest, now);
  await chat.beginTurn(String(c._id), guest, randomUUID(), 'hello', now);
  const ended = new Date(now.getTime() + 1000);
  await chat.endConversation(String(c._id), guest, ended);
  await chat.endConversation(
    String(c._id),
    guest,
    new Date(ended.getTime() + 5000)
  );
  const stored = await AiConversation.findById(c._id);
  assert.equal(stored.endedAt.getTime(), ended.getTime());
  assert.equal(stored.expiresAt.getTime(), ended.getTime() + DAY);
  const turn = await AiTurn.findOne({ conversationId: c._id });
  assert.equal(turn.expiresAt.getTime(), ended.getTime() + DAY);
  assert.equal(turn.status, 'cancelled');
  await assert.rejects(
    chat.beginTurn(String(c._id), guest, randomUUID(), 'again'),
    (e) => e.statusCode === 409
  );
});
test('idle expiry uses last activity +1h, and stale cleanup cannot end a newly active chat', async () => {
  const now = new Date();
  const old = new Date(now.getTime() - 2 * HOUR);
  const c = await chat.createConversation(guest, old);
  await chat.maintainConversations(now);
  const stored = await AiConversation.findById(c._id);
  assert.equal(stored.endedAt.getTime(), old.getTime() + HOUR);
  assert.equal(stored.expiresAt.getTime(), old.getTime() + HOUR + DAY);
  const fresh = await chat.createConversation(guest, now);
  await chat.endConversation(String(fresh._id), guest, now, old);
  assert.equal((await AiConversation.findById(fresh._id)).status, 'active');
});
test('a late End request cannot extend the guest automatic expiry deadline', async () => {
  const old = new Date(Date.now() - 2 * HOUR);
  const c = await chat.createConversation(guest, old);
  await chat.endConversation(String(c._id), guest);
  const stored = await AiConversation.findById(c._id);
  assert.equal(stored.endedAt.getTime(), old.getTime() + HOUR);
  assert.equal(stored.expiresAt.getTime(), old.getTime() + HOUR + DAY);
});
test('customer rolling retention hides expired turns before TTL deletion, regardless of completion', async () => {
  const customer = {
    kind: 'customer',
    id: new mongoose.Types.ObjectId().toString(),
  };
  const c = await chat.createConversation(customer);
  const first = await chat.beginTurn(
    String(c._id),
    customer,
    randomUUID(),
    'recent'
  );
  const sentAt = first.turn.createdAt;
  await chat.endConversation(String(c._id), customer);
  const stored = await AiTurn.findById(first.turn._id);
  assert.ok(
    Math.abs(stored.expiresAt.getTime() - sentAt.getTime() - 30 * DAY) < 1000
  );
  await AiTurn.create({
    conversationId: c._id,
    requestId: randomUUID(),
    content: 'expired',
    expiresAt: new Date(Date.now() - 1),
  });
  const history = await chat.history(String(c._id), customer);
  assert.deepEqual(
    history.rows.map((t) => t.content),
    ['recent']
  );
  await chat.maintainConversations();
  assert.equal(await AiTurn.countDocuments({ conversationId: c._id }), 1);
});
test('concurrent replay creates one turn and changed payload conflicts; owners are isolated', async () => {
  const c = await chat.createConversation(guest);
  const id = String(c._id);
  const requestId = randomUUID();
  const results = await Promise.all([
    chat.beginTurn(id, guest, requestId, 'same'),
    chat.beginTurn(id, guest, requestId, 'same'),
  ]);
  assert.equal(results.filter((r) => !r.replay).length, 1);
  assert.equal(await AiTurn.countDocuments({ conversationId: id }), 1);
  await assert.rejects(
    chat.beginTurn(id, guest, requestId, 'different'),
    (e) => e.statusCode === 409
  );
  await assert.rejects(
    chat.history(id, { kind: 'guest', id: 'someone-else' }),
    (e) => e.statusCode === 404
  );
  await assert.rejects(
    chat.endConversation(id, { kind: 'customer', id: guest.id }),
    (e) => e.statusCode === 404
  );
});
test('HTTP guest identity is cookie-only; Socket.IO uses single-use origin-bound tickets and streams', async (t) => {
  t.mock.method(aiProvider, 'answerStream', async function* () {
    yield 'Xin ';
    yield 'chào';
  });
  const post = async (path, cookie, origin = 'http://localhost:5173') =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: '{}',
    });
  assert.equal(
    (await post('/conversations', null, 'https://evil.example')).status,
    403
  );
  const initialized = await post('/session');
  const cookie = initialized.headers.get('set-cookie').split(';')[0];
  assert.match(initialized.headers.get('set-cookie'), /HttpOnly/i);
  const created = await post('/conversations', cookie);
  const id = (await created.json()).data.id;
  const ticket = (await (await post('/socket-ticket', cookie)).json()).data
    .ticket;
  const connection = io(new URL(base).origin, {
    path: '/api/v1/ai/socket',
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    auth: { ticket },
    extraHeaders: { Origin: 'http://localhost:5173' },
  });
  t.after(() => connection.disconnect());
  const events = [];
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket timeout')), 10000);
    connection.onAny((name, event) => {
      events.push(event);
      if (name === 'chat:ready')
        connection.emit('chat:send', {
          conversationId: id,
          requestId: randomUUID(),
          content: 'hello',
        });
      if (event.type === 'chat:completed') {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
  connection.connect();
  assert.equal((await completed).data.answer, 'Xin chào');
  assert.equal(events.filter((e) => e.type === 'chat:delta').length, 2);
  connection.disconnect();
  const repeat = io(new URL(base).origin, {
    path: '/api/v1/ai/socket',
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    auth: { ticket },
    extraHeaders: { Origin: 'http://localhost:5173' },
  });
  await new Promise((resolve) => {
    repeat.on('connect_error', resolve);
    repeat.connect();
  });
  repeat.disconnect();
  assert.equal(
    (await fetch(`${base}/conversations/${id}/messages`)).status,
    428
  );
});
test('customer socket authorization rejects revoked sessions', async () => {
  const customer = await Customer.create({
    firstName: 'Test',
    lastName: 'AI',
    email: 'ai@test.invalid',
    accountEnabled: true,
    isActive: true,
    tokenVersion: 2,
  });
  const stale = generateAccessToken({
    id: String(customer._id),
    accountType: 'customer',
    tokenVersion: 1,
  });
  const response = await fetch(base + '/conversations', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer ' + stale,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(response.status, 401);
});
test('Socket.IO rejects untrusted origins and expired tickets, and rechecks customer session on events', async (t) => {
  const options = {
    path: '/api/v1/ai/socket',
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    timeout: 3000,
  };
  for (const [origin, ticket] of [
    ['https://evil.example', await chat.socketTicket(guest)],
    ['http://localhost:5173', randomBytes(32).toString('hex')],
  ]) {
    const client = io(new URL(base).origin, {
      ...options,
      auth: { ticket },
      extraHeaders: { Origin: origin },
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Expected rejection')),
        5000
      );
      client.once('connect_error', () => {
        clearTimeout(timeout);
        resolve();
      });
      client.connect();
    });
    client.disconnect();
  }
  const customer = await Customer.create({
    firstName: 'Socket',
    lastName: 'AI',
    email: 'socket@test.invalid',
    accountEnabled: true,
    isActive: true,
    tokenVersion: 0,
  });
  const owner = { kind: 'customer', id: String(customer._id) };
  const c = await chat.createConversation(owner);
  const accessToken = generateAccessToken({
    id: owner.id,
    accountType: 'customer',
    tokenVersion: 0,
  });
  const client = io(new URL(base).origin, {
    ...options,
    auth: { ticket: await chat.socketTicket(owner), accessToken },
    extraHeaders: { Origin: 'http://localhost:5173' },
  });
  t.after(() => client.disconnect());
  const ready = new Promise((resolve) => client.once('chat:ready', resolve));
  client.connect();
  await ready;
  await Customer.updateOne(
    { _id: customer._id },
    { $inc: { tokenVersion: 1 } }
  );
  const rejected = new Promise((resolve) => client.once('chat:error', resolve));
  client.emit('chat:send', {
    conversationId: String(c._id),
    requestId: randomUUID(),
    content: 'hello',
  });
  await rejected;
  assert.equal(await AiTurn.countDocuments({ conversationId: c._id }), 0);
});
test('AI search verifies live variant discounts and hides stopped products despite vector hits', async (t) => {
  const brand = await BrandModel.create({ name: 'AI Brand', slug: 'ai-brand' });
  const category = await Categories.create({
    name: 'AI Category',
    slug: 'ai-category',
  });
  const product = await Product.create({
    product_name: 'AI Device',
    slug: 'ai-device',
    category: category._id,
    brand: brand._id,
    price: 9999,
    stock: 2,
    discount: 10,
    is_active: true,
    variants: [{ sku: 'AI-SKU', price: 100, stock: 2 }],
  });
  const hidden = await Product.create({
    product_name: 'AI Hidden',
    slug: 'ai-hidden',
    category: category._id,
    brand: brand._id,
    price: 90,
    on_sale: false,
    is_active: true,
  });
  const query = { q: 'AI-SKU', page: 1, limit: 10, minPrice: 80, maxPrice: 95 };
  let result = await searchProducts(query);
  assert.deepEqual(
    result.rows.map((p) => [p.id, p.price]),
    [[String(product._id), 90]]
  );
  assert.equal(
    (await searchProducts({ ...query, maxPrice: 85 })).rows.length,
    0
  );
  process.env.AI_ENABLED = 'true';
  process.env.AI_VECTOR_INDEX = 'test';
  process.env.GEMINI_API_KEY = 'mock-only';
  t.after(() => {
    process.env.AI_ENABLED = 'false';
    delete process.env.AI_VECTOR_INDEX;
    delete process.env.GEMINI_API_KEY;
  });
  t.mock.method(aiProvider, 'embed', async () => [0, 1]);
  t.mock.method(aiProvider, 'interpretQuery', async () => ({
    search: 'AI',
    brand: null,
    category: null,
    minPrice: null,
    maxPrice: 1,
  }));
  t.mock.method(AiChunk, 'aggregate', () => ({
    option: async () => [
      { key: 'product:' + hidden._id },
      { key: 'product:' + product._id },
    ],
  }));
  // Explicit UI price filters override extracted values.
  result = await searchProducts(query);
  assert.deepEqual(
    result.rows.map((p) => p.id),
    [String(product._id)]
  );
  await BrandModel.updateOne({ _id: brand._id }, { $set: { isActive: false } });
  assert.equal((await searchProducts(query)).rows.length, 0);
});
test('knowledge indexing skips unchanged embeddings and removes shortened/deleted source chunks', async (t) => {
  const embeddings = t.mock.method(aiProvider, 'embed', async () => [1, 2]);
  await indexSource(
    'document:test',
    '<p>' + 'a'.repeat(2300) + '</p>',
    'Test',
    '/faq'
  );
  assert.equal(await AiChunk.countDocuments({ key: 'document:test' }), 3);
  const calls = embeddings.mock.callCount();
  await indexSource(
    'document:test',
    '<p>' + 'a'.repeat(2300) + '</p>',
    'Test',
    '/faq'
  );
  assert.equal(embeddings.mock.callCount(), calls);
  await indexSource('document:test', 'shortened', 'Test', '/faq');
  assert.equal(await AiChunk.countDocuments({ key: 'document:test' }), 1);
  await indexSource('document:test', '', 'Test', '/faq');
  assert.equal(await AiChunk.countDocuments({ key: 'document:test' }), 0);
});
test('explicit completion cancels in-flight generation and never persists a completed answer afterwards', async (t) => {
  const c = await chat.createConversation(guest);
  const id = String(c._id);
  const requestId = randomUUID();
  const events = [];
  t.mock.method(
    aiProvider,
    'answerStream',
    async function* (_input, _context, _history, signal) {
      yield 'partial';
      await new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      });
      signal.throwIfAborted();
    }
  );
  let resolveFirst;
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const running = runChat(
    guest,
    { conversationId: id, requestId, content: 'hello' },
    AbortSignal.timeout(10000),
    (event) => {
      events.push(event);
      if (event.type === 'chat:delta') resolveFirst();
    }
  );
  await first;
  await chat.endConversation(id, guest);
  await running;
  const turn = await AiTurn.findOne({ conversationId: id, requestId });
  assert.equal(turn.status, 'cancelled');
  assert.equal(
    events.some((e) => e.type === 'chat:completed'),
    false
  );
});
test('completion racing a new message has a single serial outcome without retained processing turns', async () => {
  const c = await chat.createConversation(guest);
  const id = String(c._id);
  const results = await Promise.allSettled([
    chat.beginTurn(id, guest, randomUUID(), 'race'),
    chat.endConversation(id, guest),
  ]);
  assert.equal(results[1].status, 'fulfilled');
  assert.equal((await AiConversation.findById(id)).status, 'completed');
  assert.equal(
    await AiTurn.countDocuments({ conversationId: id, status: 'processing' }),
    0
  );
});
test('public requests never rotate guest identity; private requests require explicit initialization', async () => {
  const headers = {
    Origin: 'http://localhost:5173',
    'Content-Type': 'application/json',
  };
  const post = (path, cookie) =>
    fetch(base + path, {
      method: 'POST',
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      body: '{}',
    });
  const publicResult = await fetch(base + '/search?q=no-match');
  assert.equal(publicResult.headers.get('set-cookie'), null);
  assert.equal((await post('/conversations')).status, 428);
  const init = await post('/session');
  const cookie = init.headers.get('set-cookie').split(';')[0];
  const responses = await Promise.all([
    post('/session', cookie),
    post('/conversations', cookie),
    post('/socket-ticket', cookie),
  ]);
  for (const res of responses.slice(1)) {
    assert.ok(res.ok);
    assert.equal(res.headers.get('set-cookie'), null);
  }
  assert.equal(responses[0].headers.get('set-cookie').split(';')[0], cookie);
  const id = (await responses[1].json()).data.id;
  assert.equal(
    (
      await fetch(base + `/conversations/${id}/messages`, {
        headers: { Cookie: cookie },
      })
    ).status,
    200
  );
});
test('search batches 100 candidates without per-product metrics and handles long valid product names', async (t) => {
  const brand = await BrandModel.create({
    name: 'Batch Brand',
    slug: 'batch-brand',
  });
  const category = await Categories.create({
    name: 'Category '.repeat(12),
    slug: 'batch-category',
  });
  await Product.insertMany(
    Array.from({ length: 100 }, (_, i) => ({
      product_name: `Batch ${i}`,
      slug: `batch-${i}`,
      price: 100 + i,
      category: category._id,
      brand: brand._id,
      stock: 1,
      description: i === 99
        ? '<p>' + '😀'.repeat(499_996) + '</p>'
        : '<p>Batch description</p>',
      warrantyInformation: 'w'.repeat(100_000),
    }))
  );
  t.mock.method(mongoose.Aggregate.prototype, 'exec', async () => {
    throw new Error('Unexpected metrics aggregation');
  });
  let finds = 0;
  const cardReads = [];
  const original = mongoose.Query.prototype.exec;
  t.mock.method(mongoose.Query.prototype, 'exec', async function (...args) {
    const isExcerpt = this.model.modelName === 'Product' && this.op === 'find' && this.projection()?.description?.$substrCP;
    if (this.model.modelName === 'Product' && this.op === 'find') {
      finds++;
      if (this.projection()?.description?.$substrCP) {
        cardReads.push(this.getFilter().slug.$in);
        assert.deepEqual(this.projection().description, { $substrCP: [{ $ifNull: ['$description', ''] }, 0, 12000] });
        assert.deepEqual(this.projection().warrantyInformation, { $substrCP: [{ $ifNull: ['$warrantyInformation', ''] }, 0, 1800] });
      } else {
        for (const field of ['description', 'warrantyInformation', 'shippingInformation', 'returnPolicy'])
          assert.equal(this.projection()?.[field], undefined);
      }
    }
    const documents = await original.apply(this, args);
    if (isExcerpt) {
      for (const document of documents) {
        assert.ok([...document.description].length <= 12000);
        assert.equal(document.warrantyInformation.length, 1800);
        assert.equal(document.shippingInformation, '');
      }
    }
    return documents;
  });
  const result = await searchProducts({ q: 'Batch', page: 1, limit: 10 });
  assert.equal(result.rows.length, 10);
  assert.ok(finds <= 4, `Expected bounded batch queries, got ${finds}`);
  assert.equal(result.total, 100);
  assert.equal(cardReads.length, 1);
  assert.equal(cardReads[0].length, 10);
  assert.deepEqual(result.rows.map(p => p.slug), cardReads[0]);
  assert.ok(result.rows.every(p => p.description.length <= 1800));
  assert.equal(result.rows.find(p => p.slug === 'batch-99').description, '😀'.repeat(900));
  const second = await searchProducts({ q: 'Batch', page: 2, limit: 10 });
  assert.equal(second.total, 100);
  assert.equal(cardReads.length, 2);
  assert.equal(cardReads[1].length, 10);
  assert.deepEqual(second.rows.map(p => p.slug), cardReads[1]);
  assert.equal(new Set([...result.rows, ...second.rows].map(p => p.id)).size, 20);
  const long = await Product.create({
    product_name: 'x'.repeat(255),
    slug: 'long-valid-product',
    price: 100,
    warrantyInformation: 'w'.repeat(100_000),
    category: category._id,
    brand: brand._id,
  });
  const longResult = await searchProducts({ q: long.product_name, page: 1, limit: 10 }, undefined, false);
  assert.ok(longResult.rows.some((row) => row.id === String(long._id)));
});
test('unknown requested brand stays empty and pagination reuses successful intent/embedding results', async (t) => {
  clearAiCache();
  process.env.AI_ENABLED = 'true';
  process.env.GEMINI_API_KEY = 'mock-only';
  process.env.AI_VECTOR_INDEX = 'mock-index';
  t.after(() => {
    process.env.AI_ENABLED = 'false';
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_VECTOR_INDEX;
    clearAiCache();
  });
  const intent = t.mock.method(aiProvider, 'interpretQuery', async (q) => ({
    search: q.includes('unknown') ? '' : 'Batch',
    brand: q.includes('unknown') ? 'Definitely Missing Brand' : null,
    category: null,
    minPrice: null,
    maxPrice: null,
  }));
  const embeddings = t.mock.method(aiProvider, 'embed', async () => [0, 1]);
  t.mock.method(AiChunk, 'aggregate', () => ({ option: async () => [] }));
  assert.equal(
    (await searchProducts({ q: 'unknown brand', page: 1, limit: 10 })).total,
    0
  );
  const first = await searchProducts({
    q: 'Batch pagination',
    page: 1,
    limit: 10,
  });
  const second = await searchProducts({
    q: 'Batch pagination',
    page: 2,
    limit: 10,
  });
  assert.equal(intent.mock.callCount(), 2); // unknown brand + one shared successful intent
  assert.equal(embeddings.mock.callCount(), 1);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((p) => p.id)).size,
    20
  );
});
test('cancelling retrieval aborts embedding and intent requests before starting answer generation', async (t) => {
  clearAiCache();
  process.env.AI_ENABLED = 'true';
  process.env.GEMINI_API_KEY = 'mock-only';
  process.env.AI_VECTOR_INDEX = 'mock-index';
  t.after(() => {
    process.env.AI_ENABLED = 'false';
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_VECTOR_INDEX;
    clearAiCache();
  });
  const seen = [];
  const controller = new AbortController();
  let notify;
  const started = new Promise((resolve) => {
    notify = resolve;
  });
  const blocked = async (_text, signal) => {
    seen.push(signal);
    if (seen.length === 2) notify();
    await new Promise((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    signal.throwIfAborted();
  };
  t.mock.method(aiProvider, 'embed', blocked);
  t.mock.method(aiProvider, 'interpretQuery', blocked);
  const answer = t.mock.method(aiProvider, 'answerStream', async function* () {
    yield 'must not run';
  });
  const c = await chat.createConversation(guest);
  const requestId = randomUUID();
  const pending = runChat(
    guest,
    { conversationId: String(c._id), requestId, content: 'cancel retrieval' },
    controller.signal,
    () => {}
  );
  await started;
  controller.abort();
  await pending;
  assert.equal(answer.mock.callCount(), 0);
  assert.ok(seen.every((signal) => signal.aborted));
  assert.equal(
    (await AiTurn.findOne({ conversationId: c._id, requestId })).status,
    'cancelled'
  );
});
test('history restores product cards at live prices and omits products hidden after the answer', async () => {
  const p = await Product.findOne({ slug: 'batch-0' });
  const c = await chat.createConversation(guest);
  const { turn } = await chat.beginTurn(
    String(c._id),
    guest,
    randomUUID(),
    'history cards'
  );
  await AiTurn.updateOne(
    { _id: turn._id },
    {
      $set: {
        status: 'completed',
        productIds: [p._id],
        answer: 'Suggestion',
      },
    }
  );
  await Product.updateOne({ _id: p._id }, { $set: { price: 345 } });
  let result = await chat.history(String(c._id), guest);
  assert.equal(result.rows[0].products[0].price, 345);
  await Product.updateOne({ _id: p._id }, { $set: { on_sale: false } });
  result = await chat.history(String(c._id), guest);
  assert.deepEqual(result.rows[0].products, []);
});
test('index writes are fenced if ownership changes during an embedding call', async (t) => {
  const lease = randomUUID();
  await AiIndexJob.updateOne(
    { _id: 'sync' },
    {
      $set: {
        state: lease,
        leaseUntil: new Date(Date.now() + 120000),
        nextRunAt: new Date(),
      },
    },
    { upsert: true }
  );
  t.mock.method(aiProvider, 'embed', async () => {
    await AiIndexJob.updateOne(
      { _id: 'sync' },
      { $set: { state: 'new-owner' } }
    );
    return [0, 1];
  });
  await assert.rejects(
    indexSource('document:fenced', 'fresh text', 'Title', '/faq', { lease }),
    /lease lost/
  );
  assert.equal(await AiChunk.countDocuments({ key: 'document:fenced' }), 0);
});
test('repeated blocked requests aggregate one risk alert and indexing cannot consume the interactive allowance', async () => {
  const key = 'limit-test-' + randomUUID();
  await reserveUsage(key, 1, 60000);
  const blocked = await Promise.allSettled(
    Array.from({ length: 10 }, () => reserveUsage(key, 1, 60000))
  );
  assert.ok(
    blocked.every((r) => r.status === 'rejected' && r.reason.statusCode === 429)
  );
  const alerts = await AiRiskEvent.find({
    event: 'usage_limit',
    occurrences: 10,
  });
  assert.equal(alerts.length, 1);
  process.env.AI_DAILY_CALL_LIMIT = '8';
  try {
    await AiCounter.deleteMany({ _id: /^provider-/ });
    await reserveProviderCall('indexing');
    await reserveProviderCall('indexing');
    await assert.rejects(
      reserveProviderCall('indexing'),
      (e) => e.statusCode === 429
    );
    for (let i = 0; i < 6; i++) await reserveProviderCall('interactive');
    await assert.rejects(
      reserveProviderCall('interactive'),
      (e) => e.statusCode === 429
    );
  } finally {
    delete process.env.AI_DAILY_CALL_LIMIT;
  }
});
test('login risk observer records one domain alert instead of a generic/domain pair', async () => {
  process.env.AI_RISK_ENABLED = 'true';
  const ip = 'review-fixture-' + randomUUID();
  try {
    for (let i = 0; i < 12; i++) {
      const response = new EventEmitter();
      response.statusCode = 401;
      observeRisk(
        { method: 'POST', path: '/api/v1/auth/login', ip },
        response,
        () => {}
      );
      response.emit('finish');
    }
    const actorHash = digest('risk:login:' + digest(ip));
    for (let i = 0; i < 100; i++) {
      const alert = await AiRiskEvent.findOne({ actorHash });
      if (alert?.occurrences === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const alerts = await AiRiskEvent.find({ actorHash });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].event, 'login_failures');
    assert.equal(alerts[0].occurrences, 2);
  } finally {
    delete process.env.AI_RISK_ENABLED;
  }
});
test('history keeps the original product identity across slug changes/reuse and never guesses legacy references', async () => {
  const brand = await BrandModel.findOne({ slug: 'batch-brand' });
  const category = await Categories.findOne({ slug: 'batch-category' });
  const p = await Product.create({
    product_name: 'Original identity',
    slug: 'identity-before',
    price: 123,
    stock: 1,
    brand: brand._id,
    category: category._id,
  });
  const c = await chat.createConversation(guest);
  const { turn } = await chat.beginTurn(
    String(c._id),
    guest,
    randomUUID(),
    'identity'
  );
  await AiTurn.updateOne(
    { _id: turn._id },
    { $set: { status: 'completed', answer: 'Original', productIds: [p._id] } }
  );
  await Product.updateOne({ _id: p._id }, { $set: { slug: 'identity-after' } });
  await Product.create({
    product_name: 'Unrelated replacement',
    slug: 'identity-before',
    price: 999,
    stock: 1,
    brand: brand._id,
    category: category._id,
  });
  let result = await chat.history(String(c._id), guest);
  assert.equal(result.rows[0].products[0].id, String(p._id));
  assert.equal(result.rows[0].products[0].slug, 'identity-after');
  await AiTurn.create({
    conversationId: c._id,
    requestId: randomUUID(),
    content: 'legacy',
    answer: 'old',
    status: 'completed',
    productSlugs: ['identity-before'],
    expiresAt: new Date(Date.now() + DAY),
  });
  result = await chat.history(String(c._id), guest);
  assert.deepEqual(
    result.rows.find((t) => t.content === 'legacy').products,
    []
  );
  await Product.deleteOne({ _id: p._id });
  result = await chat.history(String(c._id), guest);
  assert.deepEqual(
    result.rows.find((t) => t.content === 'identity').products,
    []
  );
});
test('index pruning removes inactive products and hidden catalog references without any embedding call', async (t) => {
  const category = await Categories.findOne({ slug: 'batch-category' });
  const brand = await BrandModel.findOne({ slug: 'batch-brand' });
  const hiddenBrand = await BrandModel.create({
    name: 'Hidden brand',
    slug: 'prune-hidden-brand',
    isActive: false,
  });
  const hiddenCategory = await Categories.create({
    name: 'Hidden category',
    slug: 'prune-hidden-category',
    isActive: false,
  });
  const rows = await Product.insertMany([
    {
      product_name: 'Visible',
      slug: 'prune-visible',
      category: category._id,
      brand: brand._id,
    },
    {
      product_name: 'Stopped',
      slug: 'prune-stopped',
      category: category._id,
      brand: brand._id,
      is_active: false,
    },
    {
      product_name: 'Not selling',
      slug: 'prune-nosale',
      category: category._id,
      brand: brand._id,
      on_sale: false,
    },
    {
      product_name: 'Hidden brand item',
      slug: 'prune-brand',
      category: category._id,
      brand: hiddenBrand._id,
    },
    {
      product_name: 'Hidden category item',
      slug: 'prune-category',
      category: hiddenCategory._id,
      brand: brand._id,
    },
  ]);
  await AiChunk.insertMany(
    rows.map((p) => ({
      key: 'product:' + p._id,
      part: 0,
      hash: 'fixture',
      text: 'fixture',
      embedding: [0, 1],
    }))
  );
  const provider = t.mock.method(aiProvider, 'embed', async () => {
    throw new Error('No paid calls during pruning');
  });
  await pruneHiddenProductChunks();
  assert.ok(await AiChunk.exists({ key: 'product:' + rows[0]._id }));
  for (const p of rows.slice(1))
    assert.equal(await AiChunk.countDocuments({ key: 'product:' + p._id }), 0);
  assert.equal(provider.mock.callCount(), 0);
});

test('AI keyword and semantic candidates share storefront descendant and additional-category rules', async () => {
  const brand = await BrandModel.create({ name: 'Merge AI Brand', slug: 'merge-ai-brand' });
  const parent = await Categories.create({ name: 'Merge Parent', slug: 'merge-parent' });
  const child = await Categories.create({ name: 'Merge Child', slug: 'merge-child', parent: parent._id });
  const other = await Categories.create({ name: 'Merge Other', slug: 'merge-other' });
  const first = await Product.create({ product_name: 'Mergefixture secondary', slug: 'mergefixture-secondary', brand: brand._id, category: other._id, categories: [child._id], price: 100, stock: 1 });
  const second = await Product.create({ product_name: 'Mergefixture child', slug: 'mergefixture-child', brand: brand._id, category: child._id, price: 110, stock: 1 });
  const outside = await Product.create({ product_name: 'Mergefixture outside', slug: 'mergefixture-outside', brand: brand._id, category: other._id, price: 120, stock: 1 });
  const matches = Promise.resolve([first, second, outside].map(product => ({ key: 'product:' + product._id, text: 'matched', score: 1 })));
  const expected = [String(first._id), String(second._id)].sort();
  for (const category of [parent, child]) {
    for (const q of ['Mergefixture', 'semantic-only-no-keyword-match']) {
      const result = await searchProducts({ q, category: String(category._id), page: 1, limit: 20 }, matches, false);
      assert.deepEqual(result.rows.map(product => product.id).sort(), expected);
    }
  }
  await Categories.updateOne({ _id: child._id }, { $set: { isActive: false } });
  const hidden = await searchProducts({ q: 'Mergefixture', category: String(child._id), page: 1, limit: 20 }, matches, false);
  assert.equal(hidden.total, 0);
  const unknown = await searchProducts({ q: 'Mergefixture', category: '000000000000000000000000', page: 1, limit: 20 }, matches, false);
  assert.equal(unknown.total, 0);
  const controller = new AbortController();
  controller.abort(new Error('cancelled merge search'));
  await assert.rejects(searchProducts({ q: 'Mergefixture', category: String(parent._id), page: 1, limit: 20 }, matches, false, controller.signal), /cancelled merge search/);
});

test('dynamic Gemini configuration encrypts credentials, checks activation, fences updates and preserves running snapshots', async (t) => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousEncryption = process.env.AI_CONFIG_ENCRYPTION_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.AI_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  t.after(async () => {
    await AiSettings.deleteOne({ _id: 'global' });
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    if (previousEncryption === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY; else process.env.AI_CONFIG_ENCRYPTION_KEY = previousEncryption;
  });
  let state = await management.saveConnection({ revision: 0, name: 'First', provider: 'gemini', model: 'gemini-first', apiKey: 'first-secret-key-12345' }, 'admin-test');
  const first = state.connections[0];
  assert.equal(state.revision, 1);
  assert.ok(!JSON.stringify(state).includes('first-secret-key'));
  const raw = await AiSettings.collection.findOne({ _id: 'global' });
  assert.ok(raw.connections[0].encryptedKey.startsWith('v1.'));
  assert.ok(!JSON.stringify(raw).includes('first-secret-key'));
  assert.equal((await AiSettings.findById('global').lean()).connections[0].encryptedKey, undefined);
  await assert.rejects(management.saveAiSettings({ ...state.settings, revision: state.revision, activeConnectionId: first.id, enabled: true }, 'admin-test'), (e) => e.statusCode === 400);
  t.mock.method(aiProvider, 'interpretQuery', async () => ({ search: '', brand: null, category: null, minPrice: null, maxPrice: null }));
  t.mock.method(aiProvider, 'answerStream', async function* () { assert.ok(aiApiKey().includes('secret-key')); yield 'Ready'; });
  state = await management.testConnection(first.id, state.revision, 'admin-test', new AbortController().signal);
  assert.equal(state.connections[0].checkedOk, true);
  state = await management.saveAiSettings({ ...state.settings, revision: state.revision, activeConnectionId: first.id, enabled: true, dailyCalls: 37, riskEnabled: true }, 'admin-test');
  const snapshot = await resolveAiRuntime();
  assert.equal(snapshot.config.enabled, true); assert.equal(snapshot.config.dailyCalls, 37);
  assert.equal(snapshot.apiKey, 'first-secret-key-12345');
  await assert.rejects(management.deleteConnection(first.id, state.revision, 'admin-test'), (e) => e.statusCode === 409);
  await assert.rejects(management.saveConnection({ revision: state.revision, name: 'Edit active', provider: 'gemini', model: 'gemini-new' }, 'admin-test', first.id), (e) => e.statusCode === 409);
  state = await management.saveConnection({ revision: state.revision, name: 'Second', provider: 'gemini', model: 'gemini-second', apiKey: 'second-secret-key-67890' }, 'admin-test');
  const second = state.connections.find((item) => item.name === 'Second');
  state = await management.testConnection(second.id, state.revision, 'admin-test', new AbortController().signal);
  state = await management.saveAiSettings({ ...state.settings, revision: state.revision, activeConnectionId: second.id }, 'admin-test');
  await withAiRuntime(snapshot, async () => { assert.equal(aiConfig().model, 'gemini-first'); assert.equal(aiApiKey(), 'first-secret-key-12345'); });
  assert.equal((await resolveAiRuntime()).config.model, 'gemini-second');
  const concurrent = await Promise.allSettled([40, 41].map((dailyCalls) => management.saveAiSettings({ ...state.settings, revision: state.revision, dailyCalls }, 'admin-test')));
  assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find((item) => item.status === 'rejected').reason.statusCode, 409);
  state = await management.readAiSettings();
  state = await management.saveAiSettings({ ...state.settings, revision: state.revision, enabled: false, activeConnectionId: null }, 'admin-test');
  state = await management.saveConnection({ revision: state.revision, name: 'Second edited', provider: 'gemini', model: 'gemini-edited', apiKey: 'replacement-secret-key-0000' }, 'admin-test', second.id);
  assert.equal(state.connections.find((item) => item.id === second.id).checkedOk, false);
  t.mock.method(aiProvider, 'interpretQuery', async () => { throw Object.assign(new Error('provider-secret-response'), { status: 429 }); });
  state = await management.testConnection(second.id, state.revision, 'admin-test', new AbortController().signal);
  assert.equal(state.connections.find((item) => item.id === second.id).checkCode, 'AI_RATE_LIMITED');
  assert.ok(!JSON.stringify(state).includes('provider-secret-response'));
  state = await management.deleteConnection(second.id, state.revision, 'admin-test');
  assert.ok(!state.connections.some((item) => item.id === second.id));
  assert.ok(state.audit.some((entry) => entry.action === 'connection.deleted'));
  process.env.GEMINI_API_KEY = 'environment-secret-must-not-fall-back';
  const stopped = await resolveAiRuntime();
  assert.equal(stopped.config.enabled, false);
  assert.equal(stopped.apiKey, '');
});

test('versioned embeddings fence index lag, isolate dimensions/keys, switch atomically, roll back and cancel safely', async (t) => {
  const previous = process.env.AI_CONFIG_ENCRYPTION_KEY;
  process.env.AI_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  const geminiId = randomUUID(), openaiId = randomUUID();
  await AiEmbeddingChunk.init();
  await AiSettings.create({ _id: 'global', enabled: true, indexingEnabled: true, semanticEnabled: false, dailyCalls: 100, activeConnectionId: openaiId, connections: [
    { id: geminiId, name: 'Embedding Gemini', provider: 'gemini', model: 'gemini-3.1-flash-lite', encryptedKey: encryptCredential('gemini-embedding-secret', geminiId), keyHint: 'cret', checkedOk: true },
    { id: openaiId, name: 'OpenAI chat and embeddings', provider: 'openai', model: 'gpt-4.1-mini', encryptedKey: encryptCredential('openai-embedding-secret', openaiId), keyHint: 'cret', checkedOk: true },
  ] });
  t.after(async () => {
    clearAiCache();
    await AiEmbeddingChunk.deleteMany({}); await AiEmbeddingGeneration.deleteMany({}); await AiSettings.deleteOne({ _id: 'global' });
    if (previous === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY; else process.env.AI_CONFIG_ENCRYPTION_KEY = previous;
  });
  t.mock.method(knowledgeSourceProvider, 'iterate', async function* () { yield { key: 'document:warranty', text: 'Published policy '.repeat(90), title: 'Warranty', href: '/chinh-sach-bao-hanh' }; });
  const embeddings = t.mock.method(aiProvider, 'embed', async () => {
    assert.equal(aiEmbeddingKey(), aiConfig().embeddingProvider === 'gemini' ? 'gemini-embedding-secret' : 'openai-embedding-secret');
    return [1, ...Array(aiConfig().embeddingDimensions - 1).fill(0)];
  });
  let indexReady = false, visible = false, replaced = false;
  t.mock.method(vectorInfrastructure, 'ensure', async (version) => { if (!indexReady) throw new VectorIndexPending(); return (replaced ? 'replaced-' : 'physical-') + version._id; });
  t.mock.method(vectorInfrastructure, 'visible', async () => visible);
  let state = await readEmbeddingVersions();
  state = await createEmbeddingVersion({ revision: state.revision, connectionId: geminiId, model: 'gemini-embedding-001', dimensions: 768 }, 'test-admin');
  const first = state.versions[0]._id;
  const legacyCount = await AiChunk.countDocuments();
  await withAiConfig(() => runEmbeddingBuild());
  assert.equal((await AiEmbeddingGeneration.findById(first)).state, 'queued');
  assert.equal(embeddings.mock.callCount(), 0); // No provider spend before infrastructure readiness.
  indexReady = true;
  await AiEmbeddingGeneration.updateOne({ _id: first }, { $set: { nextRunAt: new Date(0) } });
  await withAiConfig(() => runEmbeddingBuild());
  let built = await AiEmbeddingGeneration.findById(first).lean();
  assert.equal(built.state, 'verifying'); assert.ok(built.chunks > 0);
  const generated = embeddings.mock.callCount();
  await assert.rejects(activateEmbeddingVersion(first, state.revision, 'test-admin'), (e) => e.statusCode === 409);
  assert.equal((await AiSettings.findById('global')).activeEmbeddingGenerationId, null);
  await assert.rejects(management.deleteConnection(geminiId, state.revision, 'test-admin'), (e) => e.statusCode === 409);
  visible = true;
  await AiEmbeddingGeneration.updateOne({ _id: first }, { $set: { nextRunAt: new Date(0) } });
  await withAiConfig(() => runEmbeddingBuild());
  built = await AiEmbeddingGeneration.findById(first).lean();
  assert.equal(built.state, 'ready'); assert.equal(built.verified, built.chunks);
  assert.equal(embeddings.mock.callCount(), generated); // Verifying again never re-embeds data.
  state = await activateEmbeddingVersion(first, state.revision, 'test-admin');
  const firstSnapshot = await resolveAiRuntime();
  assert.equal(firstSnapshot.config.provider, 'openai'); assert.equal(firstSnapshot.apiKey, 'openai-embedding-secret');
  assert.equal(firstSnapshot.config.embeddingProvider, 'gemini'); assert.equal(firstSnapshot.embeddingApiKey, 'gemini-embedding-secret');
  assert.equal(firstSnapshot.config.embeddingDimensions, 768);
  state = await createEmbeddingVersion({ revision: state.revision, connectionId: openaiId, model: 'text-embedding-3-small', dimensions: 1536 }, 'test-admin');
  const second = state.versions.find((v) => v._id !== first)._id;
  await withAiConfig(() => runEmbeddingBuild());
  assert.equal((await AiEmbeddingGeneration.findById(second)).state, 'ready');
  state = await activateEmbeddingVersion(second, state.revision, 'test-admin');
  const secondSnapshot = await resolveAiRuntime();
  assert.equal(secondSnapshot.config.embeddingProvider, 'openai'); assert.equal(secondSnapshot.config.embeddingDimensions, 1536);
  clearAiCache();
  const searches = [];
  t.mock.method(AiEmbeddingChunk, 'aggregate', (pipeline) => ({ option: async () => { searches.push(pipeline[0].$vectorSearch); return []; } }));
  await withAiRuntime(firstSnapshot, () => vectorMatches('same question'));
  await withAiRuntime(secondSnapshot, () => vectorMatches('same question'));
  assert.deepEqual(searches.map((query) => query.filter.generation), [first, second]);
  assert.deepEqual(searches.map((query) => query.queryVector.length), [768, 1536]);
  replaced = true;
  await assert.rejects(activateEmbeddingVersion(first, state.revision, 'test-admin'), (e) => e.statusCode === 409);
  assert.equal((await AiSettings.findById('global')).activeEmbeddingGenerationId, second);
  replaced = false;
  state = await activateEmbeddingVersion(first, state.revision, 'test-admin');
  await withAiRuntime(secondSnapshot, async () => { assert.equal(aiConfig().embeddingGeneration, second); assert.equal(aiEmbeddingKey(), 'openai-embedding-secret'); });
  await assert.rejects(changeEmbeddingVersion(second, state.revision, 'test-admin', 'delete'), (e) => e.statusCode === 409);
  await AiEmbeddingGeneration.updateOne({ _id: second }, { $set: { lastDeactivatedAt: new Date(Date.now() - 6 * 60000) } });
  state = await changeEmbeddingVersion(second, state.revision, 'test-admin', 'delete');
  assert.equal(await AiEmbeddingChunk.countDocuments({ generation: second }), 0);
  assert.ok(await AiEmbeddingChunk.countDocuments({ generation: first }) > 0);
  const beforeReuse = embeddings.mock.callCount();
  state = await createEmbeddingVersion({ revision: state.revision, connectionId: geminiId, model: 'gemini-embedding-001', dimensions: 768 }, 'test-admin');
  const reused = state.versions.find((v) => v._id !== first)._id;
  await withAiConfig(() => runEmbeddingBuild());
  assert.equal((await AiEmbeddingGeneration.findById(reused)).state, 'ready');
  assert.equal(embeddings.mock.callCount(), beforeReuse); // Identical space/text reuses vectors, not provider quota.
  state = await createEmbeddingVersion({ revision: state.revision, connectionId: geminiId, model: 'gemini-embedding-001', dimensions: 1536 }, 'test-admin');
  const third = state.versions.find((v) => v._id !== first && v.dimensions === 1536)._id;
  t.mock.method(aiProvider, 'embed', async () => {
    const latest = await readEmbeddingVersions();
    await changeEmbeddingVersion(third, latest.revision, 'test-admin', 'cancel');
    return [1, ...Array(1535).fill(0)];
  });
  await withAiConfig(() => runEmbeddingBuild());
  assert.equal((await AiEmbeddingGeneration.findById(third)).state, 'cancelled');
  assert.equal(await AiEmbeddingChunk.countDocuments({ generation: third }), 0);
  state = await readEmbeddingVersions();
  state = await changeEmbeddingVersion(third, state.revision, 'test-admin', 'retry');
  t.mock.method(aiProvider, 'embed', async () => { throw Object.assign(new Error('limit'), { aiCode: 'AI_USAGE_LIMIT' }); });
  await withAiConfig(() => runEmbeddingBuild());
  const paused = await AiEmbeddingGeneration.findById(third);
  assert.equal(paused.state, 'building');
  assert.equal(paused.failureCode, 'AI_USAGE_LIMIT');
  assert.ok(paused.nextRunAt > new Date());
  assert.equal((await AiSettings.findById('global')).activeEmbeddingGenerationId, first);
  assert.equal(await AiChunk.countDocuments(), legacyCount);
  // An operator switching away during an automatic refresh must win.
  t.mock.method(knowledgeSourceProvider, 'iterate', async function* () { yield { key: 'document:warranty', text: 'Refreshed policy '.repeat(90), title: 'Warranty', href: '/chinh-sach-bao-hanh' }; });
  await queueActiveEmbeddingRefresh(true);
  let switched = false;
  t.mock.method(aiProvider, 'embed', async () => {
    if (!switched) {
      switched = true;
      let current = await readEmbeddingVersions();
      await activateEmbeddingVersion(null, current.revision, 'operator');
      current = await readEmbeddingVersions();
      await activateEmbeddingVersion(first, current.revision, 'operator');
      const flags = await management.readAiSettings();
      await management.saveAiSettings({ ...flags.settings, revision: flags.revision, indexingEnabled: true }, 'operator');
    }
    return [1, ...Array(aiConfig().embeddingDimensions - 1).fill(0)];
  });
  await withAiConfig(() => runEmbeddingBuild());
  assert.equal((await AiSettings.findById('global')).activeEmbeddingGenerationId, first);
});

test('ordinary MongoDB builds, verifies, searches and automatically refreshes isolated semantic snapshots', async (t) => {
  const previous = process.env.AI_CONFIG_ENCRYPTION_KEY;
  process.env.AI_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  t.mock.method(vectorInfrastructure, 'ensure', originalVectorInfrastructure.ensure);
  t.mock.method(vectorInfrastructure, 'visible', originalVectorInfrastructure.visible);
  const connectionId = randomUUID();
  await AiSettings.create({ _id: 'global', enabled: true, indexingEnabled: false, semanticEnabled: false, dailyCalls: 100, activeConnectionId: connectionId, connections: [
    { id: connectionId, name: 'Semantic fixture', provider: 'gemini', model: 'gemini-3.1-flash-lite', encryptedKey: encryptCredential('mock-embedding-key', connectionId), keyHint: '-key', checkedOk: true },
  ] });
  t.after(async () => {
    clearAiCache();
    await AiEmbeddingChunk.deleteMany({}); await AiEmbeddingGeneration.deleteMany({}); await AiSettings.deleteOne({ _id: 'global' });
    if (previous === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY; else process.env.AI_CONFIG_ENCRYPTION_KEY = previous;
  });
  let changed = false;
  t.mock.method(knowledgeSourceProvider, 'iterate', async function* () {
    yield { key: 'document:warranty', text: changed ? 'Updated warranty' : 'Warranty coverage', title: 'Warranty', href: '/warranty' };
    if (!changed) yield { key: 'document:shipping', text: 'Shipping delivery', title: 'Shipping', href: '/shipping' };
  });
  let quotaOnce = true;
  const embed = t.mock.method(aiProvider, 'embed', async (text) => {
    if (text.includes('Shipping') && quotaOnce) {
      quotaOnce = false;
      throw Object.assign(new Error('mock daily limit'), { aiCode: 'AI_USAGE_LIMIT' });
    }
    return [...(text.includes('Shipping') ? [0, 1] : [1, 0]), ...Array(766).fill(0)];
  });
  let state = await createEmbeddingVersion({ revision: 0, connectionId, model: 'gemini-embedding-001', dimensions: 768, engine: 'exact', startSync: true }, 'test-admin');
  const first = state.versions[0]._id;
  assert.equal((await AiSettings.findById('global')).indexingEnabled, true);
  await withAiConfig(() => runEmbeddingBuild());
  const paused = await AiEmbeddingGeneration.findById(first);
  assert.equal(paused.state, 'building'); assert.equal(paused.chunks, 1);
  assert.equal(paused.failureCode, 'AI_USAGE_LIMIT'); assert.ok(paused.nextRunAt > new Date());
  await AiEmbeddingGeneration.updateOne({ _id: first }, { $set: { nextRunAt: new Date(0) } });
  await withAiConfig(() => runEmbeddingBuild());
  const built = await AiEmbeddingGeneration.findById(first);
  assert.equal(built.state, 'ready'); assert.equal(built.verified, 2);
  state = await activateEmbeddingVersion(first, state.revision, 'test-admin');
  clearAiCache();
  const matches = await withAiConfig(() => vectorMatches('guarantee repair'));
  assert.equal(matches[0].key, 'document:warranty');
  assert.ok(matches[0].score > matches[1].score);
  assert.ok(matches.every((row) => !('embedding' in row)));
  changed = true;
  await queueActiveEmbeddingRefresh(true);
  const successor = await AiEmbeddingGeneration.findOne({ parentId: first });
  assert.ok(successor.indexName.startsWith('ai_exact_'));
  assert.equal((await AiSettings.findById('global')).activeEmbeddingGenerationId, first);
  await withAiConfig(() => runEmbeddingBuild());
  assert.equal((await AiSettings.findById('global')).activeEmbeddingGenerationId, successor._id);
  const current = await withAiConfig(() => vectorMatches('guarantee repair'));
  assert.equal(current.length, 1); assert.equal(current[0].text, 'Updated warranty');
  assert.equal(await AiEmbeddingChunk.countDocuments({ generation: first }), 2);
  assert.equal(embed.mock.callCount(), 5); // 2 sources, 1 failed call, 1 query, 1 changed source.
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(withAiConfig(() => vectorMatches('cancelled', aborted.signal)), { name: 'AbortError' });
  const expiredIds = Array.from({ length: 18 }, () => randomUUID());
  await AiEmbeddingGeneration.insertMany(expiredIds.map((id) => ({
    _id: id, connectionId, provider: 'gemini', model: 'gemini-embedding-001', dimensions: 768,
    indexName: 'ai_exact_' + id.replaceAll('-', ''), state: 'ready', autoActivate: true,
    createdBy: 'worker', lastDeactivatedAt: new Date(Date.now() - 6 * 60000),
  })));
  assert.equal(await AiEmbeddingGeneration.countDocuments(), 20);
  await queueActiveEmbeddingRefresh(true);
  assert.equal(await AiEmbeddingGeneration.countDocuments(), 20);
  assert.equal(await AiEmbeddingGeneration.countDocuments({ _id: { $in: expiredIds } }), 17);
  assert.ok(await AiEmbeddingGeneration.exists({ _id: first })); // Manual rollback preserved.
  assert.ok(await AiEmbeddingGeneration.exists({ parentId: successor._id, state: 'queued' }));
  const shutdown = new AbortController(); shutdown.abort();
  await withAiConfig(() => runEmbeddingBuild(shutdown.signal));
  const interrupted = await AiEmbeddingGeneration.findOne({ parentId: successor._id });
  assert.ok(['queued', 'building', 'verifying'].includes(interrupted.state));
  assert.equal(interrupted.failureCode, 'AI_INDEX_INTERRUPTED');
  assert.equal(interrupted.leaseId, null);
  await AiEmbeddingGeneration.updateOne({ _id: interrupted._id }, { $set: { nextRunAt: new Date(0) } });
  // Worker must load fresh database settings, even when started in a disabled request snapshot.
  const stopWorker = withAiRuntime({ config: { ...environmentAiConfig(), enabled: false, indexingEnabled: false }, apiKey: '' }, () => startAiIndexWorker());
  try {
    const deadline = Date.now() + 4000;
    let resumed;
    do {
      resumed = await AiEmbeddingGeneration.findById(interrupted._id);
      if (resumed.state === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    assert.equal(resumed.state, 'ready');
  } finally { await stopWorker(); }
});

test('Gemini, OpenAI and xAI run the same chat/retrieval/persistence flow through mocked vendor transports', async (t) => {
  t.mock.method(aiProvider, 'interpretQuery', originalAIProvider.interpretQuery);
  t.mock.method(aiProvider, 'answerStream', originalAIProvider.answerStream);
  clearAiCache(); t.after(clearAiCache);
  const brand = await BrandModel.create({ name: 'Providerfixture Brand', slug: 'providerfixture-brand' });
  const category = await Categories.create({ name: 'Providerfixture Category', slug: 'providerfixture-category' });
  const product = await Product.create({ product_name: 'Providerfixture Headphones', slug: 'providerfixture-headphones', category: category._id, brand: brand._id, price: 1000, stock: 3, is_active: true });
  const network = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = JSON.parse(options.body);
    assert.ok(['api.openai.com', 'api.x.ai', 'generativelanguage.googleapis.com'].includes(new URL(String(url)).hostname));
    if (!request.stream) return Response.json({ choices: [{ index: 0, finish_reason: 'stop', message: { content: JSON.stringify({ search: '', brand: null, category: null, minPrice: null, maxPrice: null, productNames: ['Providerfixture Headphones'], referencePositions: [], task: 'search', sort: 'relevance', inherit: false }) } }] });
    const question = JSON.parse(request.messages.at(-1).content);
    assert.equal(question.verifiedStoreData.products[0].id, String(product._id));
    assert.equal(question.verifiedStoreData.products[0].price, 1000);
    const chunks = [{ choices: [{ index: 0, delta: { content: 'Providerfixture Headphones có giá 1000 đồng.' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }];
    return new Response(chunks.map((item) => 'data: ' + JSON.stringify(item) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  for (const [provider, model] of [['gemini', 'gemini-3.1-flash-lite'], ['openai', 'gpt-4.1-mini'], ['xai', 'grok-4.7']]) {
    const owner = { kind: 'guest', id: randomUUID() };
    const conversation = await chat.createConversation(owner);
    const input = { conversationId: String(conversation._id), requestId: randomUUID(), content: `Tìm Providerfixture Headphones (${provider})` };
    const events = [];
    await withAiRuntime({ config: { ...environmentAiConfig(), provider, model, enabled: true, semanticEnabled: false, vectorIndex: '', dailyCalls: 100000 }, apiKey: 'mock-vendor-credential' }, () => runChat(owner, input, new AbortController().signal, (event) => events.push(event)));
    assert.equal(events.at(-1).type, 'chat:completed');
    assert.equal(events.at(-1).data.products[0].id, String(product._id));
    assert.equal((await AiTurn.findOne({ requestId: input.requestId })).status, 'completed');
  }
  assert.equal(network.mock.callCount(), 6);
});

test('AI management endpoints require administrative permission and never serialize server credentials', async () => {
  const headers = { Origin: 'http://localhost:5173' };
  assert.equal((await fetch(base + '/admin/settings', { headers })).status, 401);
  for (const role of ['staff', 'admin']) {
    const user = await User.create({ firstName: 'AI', lastName: 'Manager', email: `ai-${role}@example.test`, password: 'test-hash-only', role, active: true });
    const token = generateAccessToken({ id: String(user._id), accountType: 'user', tokenVersion: 0 });
    const response = await fetch(base + '/admin/settings', { headers: { ...headers, Authorization: `Bearer ${token}` } });
    assert.equal(response.status, role === 'staff' ? 403 : 200);
    if (response.ok) { const body = await response.text(); assert.ok(!body.includes('encryptedKey')); assert.ok(!body.includes('GEMINI_API_KEY')); }
  }
});
