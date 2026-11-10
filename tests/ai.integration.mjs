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
import { aiProvider } from '../dist/services/ai/providers/openai.provider.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import Product from '../dist/models/products/products.model.js';
import { BrandModel } from '../dist/models/brands/brands.model.js';
import { Categories } from '../dist/models/categories/categories.model.js';
import { AiChunk } from '../dist/models/ai/ai.model.js';
import { searchProducts } from '../dist/services/ai/retrieval.service.js';
import {
  indexSource,
  pruneHiddenProductChunks,
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
import { recommendProducts } from '../dist/services/ai/retrieval.service.js';
import { observeRisk } from '../dist/services/ai/risk.service.js';
import { digest } from '../dist/services/ai/identity.service.js';
import { EventEmitter } from 'node:events';
import { generateAccessToken } from '../dist/utils/auth/token.js';
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
  process.env.OPENAI_API_KEY = 'mock-only';
  t.after(() => {
    process.env.AI_ENABLED = 'false';
    delete process.env.AI_VECTOR_INDEX;
    delete process.env.OPENAI_API_KEY;
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
    category: category._id,
    brand: brand._id,
  });
  const rows = await recommendProducts(long.slug);
  assert.ok(Array.isArray(rows));
});
test('unknown requested brand stays empty and pagination reuses successful intent/embedding results', async (t) => {
  clearAiCache();
  process.env.AI_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'mock-only';
  process.env.AI_VECTOR_INDEX = 'mock-index';
  t.after(() => {
    process.env.AI_ENABLED = 'false';
    delete process.env.OPENAI_API_KEY;
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
  process.env.OPENAI_API_KEY = 'mock-only';
  process.env.AI_VECTOR_INDEX = 'mock-index';
  t.after(() => {
    process.env.AI_ENABLED = 'false';
    delete process.env.OPENAI_API_KEY;
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
