import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import app from '../dist/app.js';
import { Customer } from '../dist/models/customers.model.js';
import { CustomerOtpJob } from '../dist/models/customer-otp-jobs.model.js';
import { emailService } from '../dist/services/email.service.js';
import { sendCustomerOtp } from '../dist/services/account-security.service.js';
import { processCustomerOtpBatch, startCustomerOtpWorker } from '../dist/services/customer-otp-worker.service.js';

process.env.OTP_SECRET = randomBytes(32).toString('hex');

function claimJob(t, { attempts = 0, email = 'customer@example.com' } = {}) {
  const job = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email, attempts, expiresAt: new Date(Date.now() + 600_000) };
  let claimed = false;
  t.mock.method(CustomerOtpJob, 'findOneAndUpdate', async (filter, update, options) => {
    assert.ok(filter.expiresAt.$gt instanceof Date);
    assert.ok(filter.leaseUntil.$lte instanceof Date);
    assert.ok(filter.runAt.$lte instanceof Date);
    assert.deepEqual(options.sort, { runAt: 1, _id: 1 });
    if (claimed) return null;
    claimed = true;
    job.leaseToken = update.$set.leaseToken;
    return job;
  });
  return job;
}

test('public OTP queues every address and finishes while SMTP remains blocked', async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const smtp = t.mock.method(emailService, 'send', () => blocked);
  const lookup = t.mock.method(Customer, 'findOne', () => { throw new Error('Public request must not inspect accounts'); });
  const jobs = [];
  t.mock.method(CustomerOtpJob, 'create', async job => { jobs.push(job); return job; });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const replies = [];
  for (const email of ['unknown@example.com', 'customer@example.com']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/customer-auth/send-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Login-Area': 'storefront' },
      body: JSON.stringify({ email }), signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200);
    replies.push(await response.json());
  }
  assert.deepEqual(replies[0], replies[1]);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.deepEqual(Object.keys(job).sort(), ['email', 'expiresAt', 'runAt']);
    assert.equal(job.expiresAt - job.runAt, 600_000);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(smtp.mock.callCount(), 0);
});

test('queue write failure stays generic and logs no recipient or upstream details', async t => {
  t.mock.method(CustomerOtpJob, 'create', async () => { throw new Error('Private Mongo details'); });
  const diagnostic = t.mock.method(console, 'error', () => {});
  const lookup = t.mock.method(Customer, 'findOne', () => { throw new Error('Must not look up account'); });
  await sendCustomerOtp('unknown@example.com');
  await sendCustomerOtp('customer@example.com');
  assert.equal(lookup.mock.callCount(), 0);
  for (const call of diagnostic.mock.calls) assert.deepEqual(call.arguments, ['Customer recovery OTP queue unavailable']);
});

test('worker discards an unknown address without sending mail and acknowledges only its lease', async t => {
  const job = claimJob(t, { email: 'unknown@example.com' });
  t.mock.method(Customer, 'findOne', () => ({ select: async () => null }));
  const smtp = t.mock.method(emailService, 'send', async () => {});
  const remove = t.mock.method(CustomerOtpJob, 'deleteOne', async filter => {
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
  });
  await processCustomerOtpBatch();
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(smtp.mock.callCount(), 0);
});

test('worker activates a code only after delivery, then deletes the completed job', async t => {
  const job = claimJob(t);
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0 }) }));
  let challenge;
  let delivered = false;
  let active = false;
  t.mock.method(Customer, 'findOneAndUpdate', async (filter, update) => {
    if (update.$set.passwordRecovery) challenge = update.$set.passwordRecovery;
    else {
      assert.equal(delivered, true);
      assert.equal(filter['passwordRecovery.id'], challenge.id);
      active = true;
    }
    return { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' };
  });
  t.mock.method(emailService, 'send', async (email, _subject, text) => {
    assert.equal(email, job.email);
    assert.equal(challenge.status, 'pending');
    const otp = text.match(/\b\d{6}\b/)[0];
    assert.notEqual(challenge.hash, otp);
    delivered = true;
  });
  t.mock.method(CustomerOtpJob, 'deleteOne', async () => { assert.equal(active, true); });
  await processCustomerOtpBatch();
  assert.equal(active, true);
});

test('failed delivery cleans only its challenge and reschedules the claimed job with bounded backoff', async t => {
  const job = claimJob(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0 }) }));
  let challenge;
  t.mock.method(Customer, 'findOneAndUpdate', async (_filter, update) => {
    challenge = update.$set.passwordRecovery;
    return { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' };
  });
  t.mock.method(emailService, 'send', async () => { throw new Error('SMTP private failure'); });
  let cleaned = false;
  t.mock.method(Customer, 'updateOne', async (filter, update) => {
    assert.equal(filter['passwordRecovery.id'], challenge.id);
    assert.deepEqual(update, { $unset: { passwordRecovery: 1 } });
    cleaned = true;
  });
  const update = t.mock.method(CustomerOtpJob, 'updateOne', async (filter, operation) => {
    assert.equal(cleaned, true);
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
    assert.equal(operation.$inc.attempts, 1);
    assert.equal(operation.$set.leaseUntil.getTime(), 0);
    assert.ok(operation.$set.runAt.getTime() > Date.now());
    assert.deepEqual(operation.$unset, { leaseToken: 1 });
  });
  await processCustomerOtpBatch();
  assert.equal(update.mock.callCount(), 1);
});

test('missing configuration drops the job after three bounded attempts', async t => {
  const job = claimJob(t, { attempts: 2 });
  t.mock.method(console, 'error', () => {});
  const previous = process.env.OTP_SECRET;
  t.after(() => { process.env.OTP_SECRET = previous; });
  delete process.env.OTP_SECRET;
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0 }) }));
  const smtp = t.mock.method(emailService, 'send', async () => {});
  const remove = t.mock.method(CustomerOtpJob, 'deleteOne', async filter => {
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
  });
  await processCustomerOtpBatch();
  assert.equal(smtp.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 1);
});

test('SMTP and cleanup failures retain the job through pending cooldown and recover on retry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.method(console, 'error', () => {});
  const job = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'customer@example.com',
    attempts: 0, runAt: new Date(0), leaseUntil: new Date(0), expiresAt: new Date(Date.now() + 600_000) };
  let deleted = false;
  let recovery;
  let deliveries = 0;
  let cleanupCalls = 0;
  t.mock.method(CustomerOtpJob, 'findOneAndUpdate', async (_filter, update) => {
    if (deleted || job.runAt.getTime() > Date.now() || job.leaseUntil.getTime() > Date.now()) return null;
    Object.assign(job, update.$set);
    return { ...job };
  });
  t.mock.method(CustomerOtpJob, 'updateOne', async (filter, update) => {
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
    Object.assign(job, update.$set);
    job.attempts += update.$inc?.attempts ?? 0;
    delete job.leaseToken;
  });
  t.mock.method(CustomerOtpJob, 'deleteOne', async filter => {
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
    deleted = true;
  });
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0, passwordRecovery: recovery,
  }) }));
  t.mock.method(Customer, 'findOneAndUpdate', async (_filter, update) => {
    if (update.$set.passwordRecovery) {
      if (recovery && recovery.resendAt.getTime() > Date.now()) return null;
      recovery = update.$set.passwordRecovery;
    } else recovery.status = 'active';
    return { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' };
  });
  t.mock.method(emailService, 'send', async () => {
    deliveries++;
    if (deliveries === 1) throw new Error('Temporary SMTP failure');
  });
  t.mock.method(Customer, 'updateOne', async () => {
    cleanupCalls++;
    throw new Error('Temporary cleanup failure');
  });

  await processCustomerOtpBatch();
  assert.equal(deliveries, 1);
  assert.equal(cleanupCalls, 1);
  assert.equal(recovery.status, 'pending');
  assert.equal(job.attempts, 1);
  assert.equal(deleted, false);
  const originalChallenge = recovery.id;

  t.mock.timers.tick(5000);
  await processCustomerOtpBatch();
  assert.equal(deliveries, 1);
  assert.equal(deleted, false);
  assert.equal(job.attempts, 1); // Waiting does not exhaust SMTP attempts.
  assert.equal(job.runAt.getTime(), recovery.resendAt.getTime());
  assert.equal(recovery.status, 'pending');

  t.mock.timers.tick(55_000);
  await processCustomerOtpBatch();
  assert.equal(deliveries, 2);
  assert.equal(recovery.status, 'active');
  assert.notEqual(recovery.id, originalChallenge);
  assert.equal(deleted, true);
});

test('a pending challenge appearing during reservation is re-read and deferred, not acknowledged', async t => {
  const job = claimJob(t);
  const resendAt = new Date(Date.now() + 50_000);
  let reads = 0;
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0,
    passwordRecovery: ++reads > 1 ? { status: 'pending', resendAt } : undefined,
  }) }));
  t.mock.method(Customer, 'findOneAndUpdate', async () => null);
  const smtp = t.mock.method(emailService, 'send', async () => {});
  const remove = t.mock.method(CustomerOtpJob, 'deleteOne', async () => {});
  const update = t.mock.method(CustomerOtpJob, 'updateOne', async (filter, operation) => {
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
    assert.equal(operation.$set.runAt.getTime(), resendAt.getTime());
    assert.equal(operation.$inc, undefined);
  });
  await processCustomerOtpBatch();
  assert.equal(reads, 2);
  assert.equal(smtp.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 1);
});

test('an active code in cooldown is skipped without scheduling another email', async t => {
  const job = claimJob(t);
  const recovery = { status: 'active', version: 0, resendAt: new Date(Date.now() + 60_000) };
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0, passwordRecovery: recovery,
  }) }));
  t.mock.method(Customer, 'findOneAndUpdate', async () => null);
  const remove = t.mock.method(CustomerOtpJob, 'deleteOne', async filter => {
    assert.deepEqual(filter, { _id: job._id, leaseToken: job.leaseToken });
  });
  const smtp = t.mock.method(emailService, 'send', async () => {});
  await processCustomerOtpBatch();
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(smtp.mock.callCount(), 0);

});

test('a pending retry beyond the job deadline is discarded without sending another code', async t => {
  const job = claimJob(t);
  const recovery = { status: 'pending', resendAt: new Date(job.expiresAt.getTime() + 1000) };
  t.mock.method(Customer, 'findOne', () => ({ select: async () => ({
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', tokenVersion: 0, passwordRecovery: recovery,
  }) }));
  t.mock.method(Customer, 'findOneAndUpdate', async () => null);
  const remove = t.mock.method(CustomerOtpJob, 'deleteOne', async () => {});
  const update = t.mock.method(CustomerOtpJob, 'updateOne', async () => {});
  const smtp = t.mock.method(emailService, 'send', async () => {});
  await processCustomerOtpBatch();
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(smtp.mock.callCount(), 0);
});

test('shutdown waits for in-flight delivery instead of abandoning its durable job', async t => {
  claimJob(t);
  t.mock.method(Customer, 'findOne', () => ({ select: async () => null }));
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  t.mock.method(CustomerOtpJob, 'deleteOne', async () => { entered(); await blocked; });
  const stop = startCustomerOtpWorker();
  await started;
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal(stopped, true);
});
