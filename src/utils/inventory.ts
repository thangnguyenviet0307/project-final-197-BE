// Missing stock is treated as zero for new variants; callers retain existing stock on updates.
export function sumVariantStock(variants: ReadonlyArray<{ stock?: number | undefined }>): number {
  return variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0);
}
