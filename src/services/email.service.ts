import nodemailer from 'nodemailer';
import createHttpError from 'http-errors';
import { z } from 'zod';

// Kept behind an object method so tests can replace delivery without a real SMTP server.
export const emailService = {
  async send(to: string, subject: string, text: string): Promise<void> {
    z.email().parse(to);
    const apiKey = process.env['BREVO_API_KEY']?.trim();
    if (apiKey) {
      const from = process.env['SMTP_FROM']?.trim() ?? '';
      const match = /^(.*?)\s*<([^<>]+)>$/.exec(from);
      const email = match?.[2]?.trim() ?? from;
      const name = match?.[1]?.trim().replace(/^"|"$/g, '');
      if (!z.email().safeParse(email).success)
        throw createHttpError(503, 'Email sender is not configured', { authCode: 'AUTH_EMAIL_UNAVAILABLE' });
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { email, ...(name ? { name } : {}) }, to: [{ email: to }], subject, textContent: text }),
          signal: AbortSignal.timeout(10_000),
        });
        await response.body?.cancel().catch(() => {});
        if (!response.ok) {
          console.error('Email API delivery failed', { status: response.status });
          throw new Error('Email API rejected delivery');
        }
        return;
      } catch {
        throw createHttpError(503, 'Không thể gửi email lúc này. Vui lòng thử lại sau.', { authCode: 'AUTH_EMAIL_UNAVAILABLE' });
      }
    }
    const host = process.env['SMTP_HOST'];
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASSWORD'];
    const from = process.env['SMTP_FROM'];
    const port = Number(process.env['SMTP_PORT'] ?? 587);
    if (!host || !user || !pass || !from || !Number.isInteger(port) || port < 1 || port > 65535)
      throw createHttpError(503, 'Email service is not configured');
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user, pass }, connectionTimeout: 5_000,
      greetingTimeout: 5_000, socketTimeout: 8_000,
      logger: false, debug: false,
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        transport.sendMail({ from, to, subject, text }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => { transport.close(); reject(new Error('Email deadline exceeded')); }, 10_000);
        }),
      ]);
      if (result.rejected.length || !result.accepted.length)
        throw new Error('Recipient rejected');
    } catch {
      throw createHttpError(503, 'Không thể gửi email lúc này. Vui lòng thử lại sau.', {
        authCode: 'AUTH_EMAIL_UNAVAILABLE',
      });
    } finally {
      clearTimeout(deadline);
      transport.close();
    }
  },
};
