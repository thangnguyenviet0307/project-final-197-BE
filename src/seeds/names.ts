import { buildSlug } from '../helpers/buildSlug.helper.js';

export interface CatalogName { name: string; slug: string }
export interface ExistingCatalog {
  brands?: CatalogName[];
  categories?: CatalogName[];
  products?: CatalogName[];
}

/** Reserve names and slugs together, including collisions caused by slug normalization. */
export function createNameAllocator(existing: readonly CatalogName[] = [], maxLength = 255) {
  const names = new Set(existing.map(value => value.name.toLowerCase()));
  const slugs = new Set(existing.map(value => value.slug.toLowerCase()));
  return (base: string): CatalogName => {
    for (let index = 1; ; index++) {
      const suffix = index === 1 ? '' : ` (${index})`;
      const name = `${base.trim().slice(0, maxLength - suffix.length).trimEnd()}${suffix}`;
      const slug = buildSlug(name);
      if (names.has(name.toLowerCase()) || slugs.has(slug.toLowerCase())) continue;
      names.add(name.toLowerCase());
      slugs.add(slug.toLowerCase());
      return { name, slug };
    }
  };
}

// Only the exact suffix used by the old seed generator is eligible for cleanup.
export const legacySeedSuffix = / ([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{8})-\d+$/i;
export function cleanLegacySeedName(name: string, slug: string): string | undefined {
  const match = legacySeedSuffix.exec(name);
  if (!match && /^seed-(?:product|category|brand)-(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{8})-\d+$/i.test(slug)) {
    return name.trim() || undefined;
  }
  if (!match || !slug.toLowerCase().endsWith(name.slice(match.index + 1).toLowerCase())) return undefined;
  const base = name.slice(0, match.index).trim();
  return base || undefined;
}
