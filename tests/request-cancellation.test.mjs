import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { get } from 'node:http';
import express from 'express';
import { errorMiddleware } from '../dist/middlewares/shared/error.middleware.js';
import { ClientDisconnectedError } from '../dist/utils/shared/request-cancellation.js';
import {
  httpAiTask,
  AI_HTTP_TIMEOUT_MS,
} from '../dist/services/ai/request-lifecycle.js';

function response() {
  return Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });
}

test('observed client cancellation is silent even if response headers were already sent', (t) => {
  const log = t.mock.method(console, 'error', () => {});
  for (const headersSent of [true, false]) {
    const res = response();
    res.destroyed = true;
    res.headersSent = headersSent;
    const write = t.mock.method(res, 'status');
    const next = t.mock.fn();
    errorMiddleware(
      new ClientDisconnectedError(),
      { aborted: true },
      res,
      next
    );
    assert.equal(write.mock.callCount(), 0);
    assert.equal(next.mock.callCount(), 0);
  }
  assert.equal(log.mock.callCount(), 0);
});

test('an unexplained AbortError on an open request remains a logged 500', (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const res = response();
  errorMiddleware(
    new DOMException('private upstream data', 'AbortError'),
    { aborted: false },
    res,
    () => assert.fail('Unexpected next')
  );
  assert.equal(res.code, 500);
  assert.equal(log.mock.callCount(), 1);
  assert.ok(!JSON.stringify(log.mock.calls).includes('private upstream data'));
  assert.equal(res.body.message, 'Internal server error');
});

test('closed or finished responses are not written again, while genuine failures stay observable', (t) => {
  const log = t.mock.method(console, 'error', () => {});
  for (const state of [
    { aborted: true },
    { destroyed: true },
    { writableEnded: true },
  ]) {
    const res = Object.assign(response(), state);
    const write = t.mock.method(res, 'status');
    errorMiddleware(
      new Error('private database details'),
      { aborted: state.aborted ?? false },
      res,
      () => assert.fail('Unexpected next')
    );
    assert.equal(write.mock.callCount(), 0);
  }
  assert.equal(log.mock.callCount(), 3);
  assert.ok(
    !JSON.stringify(log.mock.calls).includes('private database details')
  );
});

test('a live response with sent headers still delegates unexpected errors to Express', (t) => {
  const res = response();
  res.headersSent = true;
  const next = t.mock.fn();
  const error = new Error('stream failed');
  errorMiddleware(error, { aborted: false }, res, next);
  assert.equal(next.mock.calls[0].arguments[0], error);
  assert.equal(res.code, undefined);
});

test('HTTP timeout aborts upstream work with a 504 reason, not a client-cancel marker', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = response();
  let signal, failLate;
  const task = httpAiTask(req, res, async (value) => {
    signal = value;
    return new Promise((_resolve, reject) => {
      failLate = reject;
    });
  });
  const rejected = assert.rejects(task, (error) => {
    assert.equal(error.statusCode, 504);
    assert.equal(error instanceof ClientDisconnectedError, false);
    errorMiddleware(error, req, res, () => assert.fail('Unexpected next'));
    assert.equal(res.code, 504);
    return true;
  });
  await Promise.resolve();
  t.mock.timers.tick(AI_HTTP_TIMEOUT_MS);
  await rejected;
  assert.equal(signal.reason.statusCode, 504);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
  failLate(new Error('late upstream rejection'));
  await Promise.resolve();
});

test('normal completion removes disconnect listeners and does not later abort completed work', async () => {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = response();
  let signal;
  assert.equal(
    await httpAiTask(req, res, async (value) => {
      signal = value;
      return 'done';
    }),
    'done'
  );
  res.writableEnded = true;
  res.emit('close');
  assert.equal(signal.aborted, false);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('already disconnected HTTP requests never start upstream work', async (t) => {
  const req = Object.assign(new EventEmitter(), { aborted: true });
  const work = t.mock.fn();
  await assert.rejects(
    httpAiTask(req, response(), work),
    (error) => error instanceof ClientDisconnectedError
  );
  assert.equal(work.mock.callCount(), 0);
  assert.equal(req.listenerCount('aborted'), 0);
});

test('a real HTTP client disconnect aborts pending work without a 500 log or second write', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const started = Promise.withResolvers();
  const handled = Promise.withResolvers();
  let signal, finish;
  const app = express();
  app.get('/probe', async (req, res, next) => {
    try {
      await httpAiTask(req, res, async (value) => {
        signal = value;
        started.resolve();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.use((error, req, res, next) => {
    errorMiddleware(error, req, res, next);
    handled.resolve(error);
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    finish?.();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const request = get(`http://127.0.0.1:${server.address().port}/probe`);
  request.on('error', () => {});
  await started.promise;
  request.destroy();
  const error = await handled.promise;
  assert.ok(error instanceof ClientDisconnectedError);
  assert.equal(signal.aborted, true);
  assert.equal(log.mock.callCount(), 0);
});
