import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerIndexWorker,
  wakeIndexWorker,
  indexWorkerStatus,
  markIndexWorkerTick,
  markIndexWorkerError,
} from '../dist/services/ai/index-worker-control.js';

test('index worker wake/status tracks startup, safe errors and shutdown', () => {
  assert.equal(indexWorkerStatus().running, false);
  let calls = 0;
  const stop = registerIndexWorker(() => calls++);
  wakeIndexWorker();
  assert.equal(calls, 1);
  markIndexWorkerError();
  assert.equal(indexWorkerStatus().lastErrorCode, 'AI_WORKER_ERROR');
  markIndexWorkerTick();
  assert.equal(indexWorkerStatus().lastErrorCode, null);
  assert.ok(indexWorkerStatus().lastTickAt);
  stop();
  wakeIndexWorker();
  assert.equal(calls, 1);
  assert.equal(indexWorkerStatus().running, false);
});
