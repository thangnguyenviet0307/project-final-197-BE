export interface PublicationMetadata { publishedAt?: Date | null; updatedAt?: Date | null; views?: number }

/** Publication changes never replace the live view counter of an existing article. */
export function publicationChanges(prefix: string, previousContent: string | null | undefined, nextContent: string, metadata: PublicationMetadata | null | undefined, legacyDate: Date | null | undefined, now: Date): Record<string, unknown> {
  const changes: Record<string, unknown> = { [`${prefix}.publishedAt`]: previousContent ? metadata?.publishedAt ?? legacyDate ?? now : now };
  if (!previousContent) {
    changes[`${prefix}.views`] = 0;
    changes[`${prefix}.updatedAt`] = null;
  } else if (previousContent !== nextContent) changes[`${prefix}.updatedAt`] = now;
  return changes;
}
