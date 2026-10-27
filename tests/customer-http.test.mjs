import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../dist/models/users.model.js';
import { Customer } from '../dist/models/customers.model.js';
import { generateAccessToken } from '../dist/utils/token.js';
import { createRestClientProxy } from '../scripts/rest-client-proxy.mjs';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');

test('legacy customers.http creation requests are forbidden without creating records', async (t) => {
  t.mock.method(mongoose.connection, 'transaction', async (callback) => callback({}));
  const admin = new User({ email: 'fixture@example.com', firstName: 'Test', lastName: 'Admin', role: 'admin', active: true, tokenVersion: 0 });
  const records = new Map();
  t.mock.method(mongoose.Query.prototype, 'exec', async function () {
    if (this.model.modelName === 'SystemLock') return { acknowledged: true };
    if (this.model.modelName === 'Order') return null;
    if (this.model.modelName === 'User') return admin;
    assert.equal(this.model.modelName, 'Customer');
    const filter = this.getFilter();
    if (filter._id) {
      // Real customer route validation must pass a 24-digit ID to the model.
      assert.match(String(filter._id), /^[0-9a-fA-F]{24}$/);
      const entry = records.get(String(filter._id)) ?? null;
      if (this.op === 'findOneAndDelete') records.delete(String(filter._id));
      if (this.op === 'findOneAndUpdate' && entry) Object.assign(entry, this.getUpdate().$set ?? this.getUpdate());
      return entry;
    }
    return [...records.values()].find((entry) => entry.email === filter.email) ?? null;
  });
  t.mock.method(Customer.prototype, '$save', async function () {
    await this.validate();
    records.set(String(this._id), this);
    return this;
  });
  const directory = await mkdtemp(join(tmpdir(), 'customer-http-'));
  const envPath = join(directory, '.env');
  await writeFile(envPath, `ACCESS_TOKEN=${generateAccessToken({ id: String(admin._id), tokenVersion: 0 })}\nCUSTOMER_ID=\nCUSTOMER_2_ID=\nCUSTOMER_3_ID=\n`);
  const backend = app.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const proxy = createRestClientProxy({ targetUrl: `http://127.0.0.1:${backend.address().port}`, envPath });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  t.after(async () => {
    for (const server of [proxy, backend]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await unlink(envPath);
    await rmdir(directory);
  });
  const source = await readFile('REST_CLIENT/customers.http', 'utf8');
  assert.doesNotMatch(source, /__CUSTOMER(?:_2|_3)?_ID__/);
  const values = async () => dotenv.parse(await readFile(envPath));
  async function sendNamed(name) {
    const block = source.split(/^###.*$/m).find((part) => new RegExp(`^# @name ${name}$`, 'm').test(part));
    assert.ok(block, `Missing request ${name}`);
    const env = await values();
    const resolved = block.replace(/\{\{\$dotenv ([A-Z0-9_]+)\}\}/g, (_match, key) => env[key] ?? '')
      .replaceAll('{{baseUrl}}', 'http://127.0.0.1:5001/api/v1');
    const lines = resolved.split(/\r?\n/);
    const index = lines.findIndex((line) => /^(GET|POST|PUT|DELETE) /.test(line));
    const [method, url] = lines[index].split(' ');
    const headers = {};
    let cursor = index + 1;
    for (; cursor < lines.length && lines[cursor].trim(); cursor++) {
      const colon = lines[cursor].indexOf(':');
      headers[lines[cursor].slice(0, colon)] = lines[cursor].slice(colon + 1).trim();
    }
    const body = lines.slice(cursor + 1).join('\n').trim();
    const target = new URL(url);
    target.port = String(proxy.address().port);
    return fetch(target, { method, headers, ...(body ? { body } : {}) });
  }
  const missing = await sendNamed('deleteCustomer');
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).message, /ID is empty/);
  assert.equal(records.size, 0);

  for (const name of ["createCustomer", "createCustomer2", "createCustomer3"]) {
    // These old REST Client examples must no longer provision customer accounts.
    if (source.includes(`# @name ${name}`)) assert.equal((await sendNamed(name)).status, 403);
  }
  assert.equal(records.size, 0);
});
