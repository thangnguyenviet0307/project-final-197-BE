export interface HeroSlideInput {
  category: string;
  title: string;
  description?: string | undefined;
  imageUrl?: string | null | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}
export type UpdateHeroSlideInput = { [K in keyof HeroSlideInput]?: HeroSlideInput[K] | undefined } & { expectedVersion: number };
