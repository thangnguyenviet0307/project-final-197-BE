import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { trustedProxyAddresses } from '../dist/utils/trusted-proxy.js';

test('proxy configuration defaults closed and rejects blanket trust and invalid networks', () => {
  assert.equal(trustedProxyAddresses(''), false);
  assert.deepEqual(trustedProxyAddresses('127.0.0.1, ::1/128'), ['127.0.0.1', '::1/128']);
  for (const value of ['true', '1', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', '127.0.0.1,']) {
    assert.throws(() => trustedProxyAddresses(value));
  }
});

test('forwarded IP is accepted only through an explicitly trusted peer', async () => {
  for (const [setting, expected] of [[false, '127.0.0.1'], [['127.0.0.1'], '198.51.100.7'], [['192.0.2.1'], '127.0.0.1']]) {
    const app = express();
    app.set('trust proxy', setting);
    app.get('/', (req, res) => res.json({ ip: req.ip }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, { headers: { 'X-Forwarded-For': '203.0.113.9, 198.51.100.7' } });
      assert.equal((await response.json()).ip, expected);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
