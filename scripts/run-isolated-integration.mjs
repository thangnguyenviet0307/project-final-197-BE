// Starts a fresh loopback-only replica set. Never reads dotenv or an app URI.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const binary = process.env.MONGOD_BINARY;
if (!binary) throw new Error('Set MONGOD_BINARY to the installed mongod executable');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL(`../.local-backups/mongo-integration-${randomUUID()}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const mongod = spawn(binary, ['--dbpath', fileURLToPath(directory), '--port', String(port),
  '--bind_ip', '127.0.0.1', '--replSet', 'reviewTest', '--logpath', fileURLToPath(new URL('mongod.log', directory))],
{ cwd: root, windowsHide: true, stdio: 'ignore' });
let spawnError;
mongod.on('error', error => { spawnError = error; });
const uri = `mongodb://127.0.0.1:${port}/?replicaSet=reviewTest&directConnection=true`;
// Do not require a set name until replSetInitiate has configured this server.
const client = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000 });
const delay = () => new Promise(resolve => setTimeout(resolve, 300));
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError || mongod.exitCode !== null) throw new Error('Isolated mongod failed to start; inspect its local log');
    try { await client.connect(); await client.db('admin').command({ ping: 1 }); ready = true; break; }
    catch (error) { if (attempt === 0 || attempt === 99) console.log(`Waiting for isolated MongoDB: ${error.name}`); await delay(); }
  }
  if (!ready) throw new Error('Isolated MongoDB did not become ready');
  await client.db('admin').command({ replSetInitiate: { _id: 'reviewTest', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) { ready = true; break; }
    await delay();
  }
  if (!ready) throw new Error('Isolated replica set did not elect a primary');
  console.log('Running integration against a fresh loopback replica set; application database is not used.');
  const child = spawn(process.execPath, ['--test', 'tests/orders.integration.mjs'], {
    cwd: root, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, MONGODB_TEST_URI: uri, MONGODB_URI: '', NODE_ENV: 'test' },
  });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  // Stop this server only. Retain its isolated directory/log for review.
  try { await client.db('admin').command({ shutdown: 1, force: true, timeoutSecs: 1 }); } catch { /* Shutdown closes the socket. */ }
  await client.close();
  if (mongod.exitCode === null && !spawnError) {
    const stopped = once(mongod, 'exit');
    const timeout = setTimeout(() => mongod.kill(), 5000);
    await stopped;
    clearTimeout(timeout);
  }
  console.log(`Isolated database stopped. Logs retained in ${fileURLToPath(directory)}`);
}
