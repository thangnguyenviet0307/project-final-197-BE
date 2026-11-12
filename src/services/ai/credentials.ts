import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import createError from 'http-errors';
export function credentialsReady() {
  return /^[a-f0-9]{64}$/i.test(process.env['AI_CONFIG_ENCRYPTION_KEY'] ?? '');
}
function encryptionKey() {
  if (!credentialsReady())
    throw createError(503, 'AI configuration encryption is not configured');
  return Buffer.from(process.env['AI_CONFIG_ENCRYPTION_KEY']!, 'hex');
}
export function encryptCredential(value: string, id: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function decryptCredential(value: string, id: string) {
  try {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64')
    );
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw createError(503, 'AI credential could not be decrypted');
  }
}
