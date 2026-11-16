import { buildSlug } from './buildSlug.helper.js';

export type ResourceKind = 'don-hang' | 'khach-hang' | 'bao-hanh';

// A stable, unique suffix supports legacy records without database rewrites.
// Slugs are navigation keys; authorization always uses the resolved record ID.
export function resourceSlug(kind: ResourceKind, id: unknown): string {
  const value = String(id);
  if (!/^[a-f\d]{24}$/i.test(value)) throw new Error('Invalid resource identity');
  return buildSlug(`${kind}-${BigInt(`0x${value}`).toString(36)}`);
}
