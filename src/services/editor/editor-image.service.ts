import createError from 'http-errors';
import { withCatalogImage } from '../products/catalog-image.service.js';

export async function uploadEditorImage(file?: Express.Multer.File) {
  if (!file) throw createError(400, 'Select an image to upload');
  return withCatalogImage(file, 'editor', async (image) => {
    if (!image) throw createError(502, 'Image upload failed');
    return { url: image.url, publicId: image.publicId };
  });
}
