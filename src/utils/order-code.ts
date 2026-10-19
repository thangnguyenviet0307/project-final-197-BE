import { randomInt } from 'node:crypto';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateOrderCode(): string {
  return 'ORD-' + Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
}
export function isOrderCodeCollision(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: number; keyPattern?: Record<string, unknown> };
  return value.code === 11000 && Boolean(value.keyPattern?.['orderCode']);
}