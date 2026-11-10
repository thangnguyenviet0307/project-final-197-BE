import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import nodemailer from 'nodemailer';
import { User } from '../dist/models/users/users.model.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import { emailService } from '../dist/services/auth/email.service.js';
import {
  deliverCustomerOtp,
  verifyCustomerOtp,
  resetCustomerPassword,
  sendEmailVerification,
  verifyPersonalEmail,
} from '../dist/services/auth/account-security.service.js';
import { UserService } from '../dist/services/users/users.service.js';
import {
  login,
  changePassword,
  refresh,
} from '../dist/services/auth/auth.service.js';
import { updateProfile } from '../dist/services/users/profile.service.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';
import {
  assertTemporaryPasswordValid,
  TEMPORARY_PASSWORD_MS,
  securityDigest,
} from '../dist/utils/auth/account-security.js';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString('hex');
process.env.OTP_SECRET = randomBytes(32).toString('hex');
const { default: app } = await import('../dist/app.js');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

// Small in-memory Mongo adapter evaluates the actual service predicates, including expiry and CAS.
const get = (record, key) =>
  key.split('.').reduce((value, part) => value?.[part], record);
function matches(record, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or')
      return expected.some((branch) => matches(record, branch));
    if (key === '$and')
      return expected.every((branch) => matches(record, branch));
    const value = get(record, key);
    if (expected && typeof expected === 'object' && !(expected instanceof Date))
      return Object.entries(expected).every(([op, operand]) => {
        if (op === '$exists') return (value !== undefined) === operand;
        if (op === '$gt') return value > operand;
        if (op === '$lte') return value <= operand;
        if (op === '$lt') return value < operand;
        if (op === '$ne') return value !== operand;
        if (op === '$in') return operand.includes(value);
        if (op === '$regex') return operand.test(value ?? '');
        throw new Error(`Unsupported filter ${op}`);
      });
    return String(value) === String(expected);
  });
}
function assign(record, path, value, remove = false) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = record;
  for (const key of keys) target = target[key] ??= {};
  if (remove) delete target[last];
  else target[last] = value;
}
const query = (value) => ({
  select: async () => structuredClone(value),
  then: (resolve) => resolve(structuredClone(value)),
});
function database(t, Model, record) {
  const writes = [];
  t.mock.method(Model, 'findOne', (filter) =>
    query(record && matches(record, filter) ? record : null)
  );
  t.mock.method(Model, 'findById', (id) =>
    query(record && String(record._id) === String(id) ? record : null)
  );
  const update = (filter, change) => {
    writes.push({ filter, change });
    if (!record || !matches(record, filter)) return null;
    for (const [key, value] of Object.entries(change.$set ?? {}))
      assign(record, key, value);
    for (const [key, value] of Object.entries(change.$inc ?? {}))
      assign(record, key, (get(record, key) ?? 0) + value);
    for (const key of Object.keys(change.$unset ?? {}))
      assign(record, key, undefined, true);
    return record;
  };
  t.mock.method(Model, 'findOneAndUpdate', (filter, change) =>
    query(update(filter, change))
  );
  t.mock.method(Model, 'updateOne', async (filter, change) => ({
    modifiedCount: update(filter, change) ? 1 : 0,
  }));
  return writes;
}
const customer = () => ({
  _id: '507f1f77bcf86cd799439011',
  email: 'buyer@example.com',
  firstName: 'Buyer',
  lastName: 'Test',
  isActive: true,
  accountEnabled: true,
  tokenVersion: 0,
});
const employee = () => ({
  _id: '507f1f77bcf86cd799439012',
  email: 'employee@example.com',
  personalEmail: 'personal@example.com',
  firstName: 'Staff',
  lastName: 'Test',
  active: true,
  role: 'staff',
  tokenVersion: 0,
  onboardingRequired: true,
});
const actor = (record) => ({ ...record, id: record._id });
function mailbox(t) {
  const messages = [];
  t.mock.method(emailService, 'send', async (to, subject, text) =>
    messages.push({ to, subject, text })
  );
  return messages;
}
const code = (messages) => messages.at(-1).text.match(/\b\d{6}\b/)[0];

test('customer recovery stores no plain OTP, consumes once, hashes new password and revokes old sessions', async (t) => {
  const record = customer();
  record.password = await argon2.hash('Previous123!');
  database(t, Customer, record);
  const messages = mailbox(t);
  await deliverCustomerOtp(record.email);
  const otp = code(messages);
  assert.equal(record.passwordRecovery.status, 'active');
  assert.notEqual(record.passwordRecovery.hash, otp);
  assert.equal(JSON.stringify(record).includes(`"${otp}"`), false);
  const outcomes = await Promise.allSettled([
    verifyCustomerOtp(record.email, otp),
    verifyCustomerOtp(record.email, otp),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1
  );
  const grant = outcomes.find((result) => result.status === 'fulfilled').value;
  assert.notEqual(record.passwordRecovery.resetHash, grant.resetToken);
  assert.equal(record.passwordRecovery.hash, undefined);
  await resetCustomerPassword({
    email: record.email,
    resetToken: grant.resetToken,
    newPassword: 'Updated123!',
  });
  assert.ok(await argon2.verify(record.password, 'Updated123!'));
  assert.equal(record.passwordRecovery, undefined);
  assert.equal(record.tokenVersion, 1);
  assert.equal(record.refreshToken, null);
  await assert.rejects(
    resetCustomerPassword({
      email: record.email,
      resetToken: grant.resetToken,
      newPassword: 'Another123!',
    }),
    { status: 400 }
  );
});

test('OTP expires exactly at five minutes and sending again invalidates the old code', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const record = customer();
  database(t, Customer, record);
  const messages = mailbox(t);
  await deliverCustomerOtp(record.email);
  const oldId = record.passwordRecovery.id;
  await deliverCustomerOtp(record.email);
  assert.equal(messages.length, 1);
  t.mock.timers.tick(60_000);
  await deliverCustomerOtp(record.email);
  assert.notEqual(record.passwordRecovery.id, oldId);
  const otp = code(messages);
  t.mock.timers.tick(300_000);
  await assert.rejects(verifyCustomerOtp(record.email, otp), { status: 400 });
});

test('five wrong attempts lock a code even when the sixth attempt is correct', async (t) => {
  const record = customer();
  database(t, Customer, record);
  const messages = mailbox(t);
  await deliverCustomerOtp(record.email);
  const otp = code(messages);
  const wrong = otp === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt++)
    await assert.rejects(verifyCustomerOtp(record.email, wrong), {
      status: 400,
    });
  await assert.rejects(verifyCustomerOtp(record.email, otp), { status: 400 });
  assert.equal(record.passwordRecovery.attempts, 5);
});

test('unknown and disabled accounts never receive mail; SMTP failure leaves no usable challenge', async (t) => {
  const record = customer();
  record.isActive = false;
  database(t, Customer, record);
  const messages = mailbox(t);
  await deliverCustomerOtp('missing@example.com');
  assert.equal(messages.length, 0);
  await deliverCustomerOtp(record.email);
  assert.equal(messages.length, 0);
  record.isActive = true;
  emailService.send.mock.mockImplementation(async () => {
    throw Object.assign(new Error('SMTP unavailable'), { status: 503 });
  });
  await assert.rejects(deliverCustomerOtp(record.email), { status: 503 });
  assert.equal(record.passwordRecovery, undefined);
});

test('reset grant expires and a session-version change invalidates an existing challenge', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const record = customer();
  database(t, Customer, record);
  const messages = mailbox(t);
  await deliverCustomerOtp(record.email);
  const grant = await verifyCustomerOtp(record.email, code(messages));
  t.mock.timers.tick(300_000);
  await assert.rejects(
    resetCustomerPassword({
      email: record.email,
      resetToken: grant.resetToken,
      newPassword: 'Updated123!',
    }),
    { status: 400 }
  );
  await deliverCustomerOtp(record.email);
  record.tokenVersion++;
  await assert.rejects(verifyCustomerOtp(record.email, code(messages)), {
    status: 400,
  });
});

test('personal email is verified only for its current address/version and completes onboarding once', async (t) => {
  const record = employee();
  database(t, User, record);
  const messages = mailbox(t);
  await sendEmailVerification(actor(record));
  await verifyPersonalEmail(actor(record), code(messages));
  assert.equal(record.personalEmailVerified, true);
  assert.equal(record.onboardingRequired, false);
  assert.equal(record.emailVerification, undefined);
  await assert.rejects(verifyPersonalEmail(actor(record), code(messages)), {
    status: 400,
  });
});

test('email edit removes old verification and pending reset, then requires re-verification', async (t) => {
  const record = employee();
  record.personalEmailVerified = true;
  record.onboardingRequired = false;
  record.emailVerification = { id: 'old' };
  record.pendingPassword = { id: 'old' };
  database(t, User, record);
  await updateProfile(actor(record), {
    firstName: 'Staff',
    lastName: 'Test',
    personalEmail: 'new@example.com',
    phone: '',
    location: '',
    bio: '',
  });
  assert.equal(record.personalEmailVerified, false);
  assert.equal(record.onboardingRequired, true);
  assert.equal(record.emailVerification, undefined);
  assert.equal(record.pendingPassword, undefined);
});

test('admin reset mails only verified personalEmail, hashes random password, enforces 30 minutes and removes pending state', async (t) => {
  const record = employee();
  record.personalEmailVerified = true;
  record.password = await argon2.hash('Old123!');
  database(t, User, record);
  const messages = mailbox(t);
  await UserService.resetPassword(record._id, { id: 'admin', role: 'admin' });
  assert.equal(messages[0].to, record.personalEmail);
  const temporary = messages[0].text.match(/: (\S+)/)[1];
  assert.ok(await argon2.verify(record.password, temporary));
  assert.equal(record.pendingPassword, undefined);
  assert.equal(record.mustChangePassword, true);
  assert.equal(record.tokenVersion, 1);
  assert.ok(
    record.temporaryPasswordExpiresAt.getTime() - Date.now() <=
      TEMPORARY_PASSWORD_MS
  );
  assert.ok(
    record.temporaryPasswordExpiresAt.getTime() - Date.now() >
      TEMPORARY_PASSWORD_MS - 5000
  );
});

test('failed SMTP preserves current password; unverified recipients and protected roles cannot reset', async (t) => {
  const record = employee();
  record.personalEmailVerified = true;
  record.password = 'original-hash';
  database(t, User, record);
  t.mock.method(emailService, 'send', async () => {
    throw Object.assign(new Error('SMTP'), { status: 503 });
  });
  await assert.rejects(
    UserService.resetPassword(record._id, { id: 'admin', role: 'admin' }),
    { status: 503 }
  );
  assert.equal(record.password, 'original-hash');
  assert.equal(record.pendingPassword, undefined);
  record.personalEmailVerified = false;
  await assert.rejects(
    UserService.resetPassword(record._id, { id: 'admin', role: 'admin' }),
    { status: 409 }
  );
  record.role = 'super_admin';
  await assert.rejects(
    UserService.resetPassword(record._id, { id: 'admin', role: 'admin' }),
    { status: 404 }
  );
});

test('temporary password expires at its boundary; successful change removes it and rejects its subsequent use', async (t) => {
  const record = employee();
  record.password = await argon2.hash('Temporary123!');
  record.mustChangePassword = true;
  record.temporaryPasswordExpiresAt = new Date(
    Date.now() + TEMPORARY_PASSWORD_MS
  );
  database(t, User, record);
  assert.throws(
    () =>
      assertTemporaryPasswordValid(record, record.temporaryPasswordExpiresAt),
    { status: 401 }
  );
  const session = await login(record.email, 'Temporary123!');
  const deadline = record.temporaryPasswordExpiresAt.getTime();
  assert.equal(record.temporaryPasswordExpiresAt.getTime(), deadline);
  await changePassword(record._id, {
    currentPassword: 'Temporary123!',
    newPassword: 'Permanent123!',
  });
  assert.equal(record.temporaryPasswordExpiresAt, undefined);
  assert.equal(record.mustChangePassword, false);
  assert.equal(record.onboardingRequired, true);
  assert.equal(record.tokenVersion, 1);
  await assert.rejects(login(record.email, 'Temporary123!'), { status: 401 });
  await assert.rejects(refresh(session.refreshToken), { status: 401 });
  const next = await login(record.email, 'Permanent123!');
  assert.equal(next.user.onboardingRequired, true);
});

test('expired credentials cannot login, refresh or change password; reissue is limited to incomplete accounts', async (t) => {
  const record = employee();
  record.password = await argon2.hash('Temporary123!');
  record.mustChangePassword = true;
  record.temporaryPasswordExpiresAt = new Date(Date.now() - 1);
  database(t, User, record);
  await assert.rejects(login(record.email, 'Temporary123!'), { status: 401 });
  await assert.rejects(
    changePassword(record._id, {
      currentPassword: 'Temporary123!',
      newPassword: 'Permanent123!',
    }),
    { status: 401 }
  );
  await UserService.reissueInitialPassword(record._id, 'Reissued123!', {
    id: 'admin',
    role: 'admin',
  });
  assert.ok(await argon2.verify(record.password, 'Reissued123!'));
  assert.equal(record.tokenVersion, 1);
  record.personalEmailVerified = true;
  await assert.rejects(
    UserService.reissueInitialPassword(record._id, 'Other123!', {
      id: 'admin',
      role: 'admin',
    }),
    { status: 409 }
  );
});

test('HTTP validates recovery before sending and enforces account area and onboarding restrictions', async (t) => {
  const delivery = mailbox(t);
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  for (const body of [
    { email: 'bad' },
    { email: 'buyer@example.com', role: 'admin' },
  ])
    assert.equal(
      (
        await post('/customer-auth/send-otp', body, {
          'X-Login-Area': 'storefront',
        })
      ).status,
      400
    );
  assert.equal(delivery.length, 0);
  assert.equal(
    (
      await post(
        '/customer-auth/send-otp',
        { email: 'buyer@example.com' },
        { 'X-Login-Area': 'admin' }
      )
    ).status,
    403
  );
  const record = employee();
  database(t, User, record);
  const headers = {
    Authorization: `Bearer ${generateAccessToken(actor(record))}`,
  };
  assert.equal((await fetch(base + '/users', { headers })).status, 403);
  assert.equal((await fetch(base + '/auth/me', { headers })).status, 200);
  record.mustChangePassword = true;
  record.temporaryPasswordExpiresAt = new Date(Date.now() - 1);
  assert.equal((await fetch(base + '/auth/me', { headers })).status, 401);
});

test('private security fields are excluded from both model serialization paths', () => {
  const value = {
    ...employee(),
    password: 'hash',
    emailVerification: { id: 'private' },
    pendingPassword: { hash: 'private' },
  };
  const user = new User(value);
  const buyer = new Customer({
    ...customer(),
    passwordRecovery: { id: 'private' },
  });
  for (const result of [user.toJSON(), user.toObject()])
    for (const key of ['password', 'pendingPassword', 'emailVerification'])
      assert.equal(result[key], undefined);
  for (const result of [buyer.toJSON(), buyer.toObject()])
    assert.equal(result.passwordRecovery, undefined);
  assert.notEqual(securityDigest('a', '123456'), securityDigest('b', '123456'));
});

test('SMTP adapter requires validated recipients, TLS and bounded timeouts, and hides upstream errors', async t => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'BREVO_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  } });
  delete process.env.BREVO_API_KEY;
  Object.assign(process.env, { SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_USER: 'login', SMTP_PASSWORD: 'private-key', SMTP_FROM: 'sender@example.com' });
  let deliveries = 0, closed = 0, rejected = false;
  t.mock.method(nodemailer, 'createTransport', options => {
    assert.equal(options.requireTLS, true); assert.equal(options.logger, false); assert.equal(options.debug, false);
    assert.ok(options.socketTimeout <= 15_000); assert.ok(options.connectionTimeout <= 10_000);
    return {
      async sendMail(message) {
        deliveries++;
        assert.equal(message.to, 'recipient@example.com');
        if (rejected) throw new Error('private-key upstream secret');
        return { accepted: ['recipient@example.com'], rejected: [] };
      },
      close() {
        closed++;
      },
    };
  });
  await assert.rejects(
    emailService.send('bad\r\nBcc: other@example.com', 'Subject', 'Body')
  );
  assert.equal(deliveries, 0);
  await emailService.send('recipient@example.com', 'Subject', 'Body');
  assert.equal(closed, 1);
  rejected = true;
  await assert.rejects(
    emailService.send('recipient@example.com', 'Subject', 'Body'),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.message.includes('private-key'), false);
      return true;
    }
  );
  assert.equal(closed, 2);
  delete process.env.SMTP_PASSWORD;
  await assert.rejects(
    emailService.send('recipient@example.com', 'Subject', 'Body'),
    { status: 503 }
  );
});
