import { z } from 'zod';
type ResourceKind = 'don-hang' | 'khach-hang' | 'bao-hanh';
export function resourceId(kind: ResourceKind, value: string): string | null {
  if (/^[a-f\d]{24}$/i.test(value)) return value;
  const prefix = `${kind}-`;
  if (!value.startsWith(prefix)) return null;
  const token = value.slice(prefix.length);
  if (!/^[a-z0-9]{1,19}$/.test(token)) return null;
  let number = 0n;
  for (const character of token) number = number * 36n + BigInt(parseInt(character, 36));
  const id = number.toString(16).padStart(24, '0');
  if (id.length !== 24 || number.toString(36) !== token) return null;
  return id;
}

export const resourceKeySchema = (kind: ResourceKind) => z.string().max(255)
  .transform((value, context) => {
    const id = resourceId(kind, value);
    if (id) return id;
    context.addIssue({ code: 'custom', message: 'Invalid resource slug' });
    return z.NEVER;
  });

export const resourceParamSchema = (kind: ResourceKind) => z.strictObject({ id: resourceKeySchema(kind) });
