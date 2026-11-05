import nodemailer from 'nodemailer';
import createHttpError from 'http-errors';
import { z } from 'zod';

// Kept behind an object method so tests can replace delivery without a real SMTP server.
export const emailService = {
  async send(to: string, subject: string, text: string): Promise<void> {
    z.email().parse(to);
    const host = process.env['SMTP_HOST'];
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASSWORD'];
    const from = process.env['SMTP_FROM'];
    const port = Number(process.env['SMTP_PORT'] ?? 587);
    if (!host || !user || !pass || !from || !Number.isInteger(port) || port < 1 || port > 65535)
      throw createHttpError(503, 'Email service is not configured');
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user, pass }, connectionTimeout: 10_000,
      greetingTimeout: 10_000, socketTimeout: 15_000,
      logger: false, debug: false,
    });
    try {
      const result = await transport.sendMail({ from, to, subject, text });
      if (result.rejected.length || !result.accepted.length)
        throw new Error('Recipient rejected');
    } catch {
      throw createHttpError(503, 'Không thể gửi email lúc này. Vui lòng thử lại sau.', {
        authCode: 'AUTH_EMAIL_UNAVAILABLE',
      });
    } finally {
      transport.close();
    }
  },
};
