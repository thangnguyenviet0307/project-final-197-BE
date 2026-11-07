import createHttpError from 'http-errors';

const folders = {
  products: ['CLOUDINARY_PRODUCT_FOLDER', 'project-final/products'],
  brands: ['CLOUDINARY_BRAND_FOLDER', 'project-final/brands'],
  categories: ['CLOUDINARY_CATEGORY_FOLDER', 'project-final/categories'],
  warranty: ['CLOUDINARY_WARRANTY_FOLDER', 'project-final/warranty'],
} as const;

export function getCloudinaryFolder(
  kind: keyof typeof folders,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const [variable, fallback] = folders[kind];
  const value = (environment[variable] || fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (
    value.length > 80 ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value)
  ) {
    throw createHttpError(
      503,
      `Invalid image folder configuration: ${variable}`
    );
  }
  return value;
}
