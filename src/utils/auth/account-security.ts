import { createHmac, randomBytes, randomInt } from 'node:crypto';
import createHttpError from 'http-errors';

export const OTP_LIFETIME_MS = 5 * 60 * 1000;
export const OTP_COOLDOWN_MS = 60 * 1000;
export const TEMPORARY_PASSWORD_MS = 30 * 60 * 1000;

export function securityDigest(purpose: string, value: string): string {
  const secret = process.env['OTP_SECRET'];
  if (!secret || Buffer.byteLength(secret) < 32)
    throw createHttpError(503, 'Email security is not configured');
  return createHmac('sha256', secret)
    .update(`${purpose}:${value}`)
    .digest('hex');
}

export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const newSecret = () => randomBytes(32).toString('hex');
export function newTemporaryPassword(): string {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%',
  ];
  const alphabet = groups.join('');
  const characters = groups.map((group) => group[randomInt(group.length)]!);
  while (characters.length < 8)
    characters.push(alphabet[randomInt(alphabet.length)]!);
  for (let index = characters.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [characters[index], characters[other]] = [
      characters[other]!,
      characters[index]!,
    ];
  }
  return characters.join('');
}

export function assertTemporaryPasswordValid(
  user: {
    mustChangePassword?: boolean;
    temporaryPasswordExpiresAt?: Date;
  },
  now = new Date()
): void {
  // Missing deadlines are existing accounts, not newly issued credentials.
  if (
    user.mustChangePassword &&
    user.temporaryPasswordExpiresAt &&
    user.temporaryPasswordExpiresAt.getTime() <= now.getTime()
  )
    throw createHttpError(
      401,
      'Mật khẩu tạm đã hết hạn. Vui lòng liên hệ quản trị viên.',
      {
        authCode: 'AUTH_TEMPORARY_PASSWORD_EXPIRED',
      }
    );
}
