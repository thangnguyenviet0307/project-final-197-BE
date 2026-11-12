import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailService } from '../dist/services/auth/email.service.js';
import { newTemporaryPassword } from '../dist/utils/auth/account-security.js';
import nodemailer from 'nodemailer';

function configure(t) {
  const previous = { ...process.env };
  t.after(() => {
    process.env = previous;
  });
  process.env.BREVO_API_KEY = 'test-api-key';
  process.env.SMTP_FROM = 'Demo Store <sender@example.com>';
  delete process.env.SMTP_PASSWORD;
}

test('temporary passwords have eight random characters and all required character classes', () => {
  const passwords = new Set();
  for (let index = 0; index < 1000; index++) {
    const password = newTemporaryPassword();
    assert.equal(password.length, 8);
    for (const pattern of [/[A-Z]/, /[a-z]/, /[0-9]/, /[!@#$%]/])
      assert.match(password, pattern);
    passwords.add(password);
  }
  assert.equal(passwords.size, 1000);
});

test('Brevo HTTPS delivery works without SMTP credentials and uses the configured sender', async (t) => {
  configure(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.headers['api-key'], 'test-api-key');
    assert.deepEqual(JSON.parse(options.body), {
      sender: { email: 'sender@example.com', name: 'Demo Store' },
      to: [{ email: 'recipient@example.com' }],
      subject: 'OTP',
      textContent: 'Code: 123456',
    });
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ messageId: 'test' }), { status: 201 });
  });
  await emailService.send('recipient@example.com', 'OTP', 'Code: 123456');
});

test('Brevo rejection and network failures produce a sanitized actionable error', async (t) => {
  configure(t);
  t.mock.method(console, 'error', () => {});
  const request = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('private provider detail', { status: 401 })
  );
  await assert.rejects(
    emailService.send('recipient@example.com', 'OTP', 'Code'),
    { status: 503, authCode: 'AUTH_EMAIL_UNAVAILABLE' }
  );
  request.mock.mockImplementation(async () => {
    throw new Error('private secret');
  });
  await assert.rejects(
    emailService.send('recipient@example.com', 'OTP', 'Code'),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.message.includes('private'), false);
      return true;
    }
  );
});

test('an unresponsive SMTP delivery is closed and rejected after ten seconds', async (t) => {
  configure(t);
  delete process.env.BREVO_API_KEY;
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'test',
    SMTP_PASSWORD: 'test',
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = false;
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: () => new Promise(() => {}),
    close: () => {
      closed = true;
    },
  }));
  const result = assert.rejects(
    emailService.send('recipient@example.com', 'OTP', 'Code'),
    { status: 503, authCode: 'AUTH_EMAIL_UNAVAILABLE' }
  );
  t.mock.timers.tick(10_000);
  await result;
  assert.equal(closed, true);
});
