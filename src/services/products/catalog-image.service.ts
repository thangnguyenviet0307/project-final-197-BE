import { randomUUID } from 'node:crypto';
import createHttpError from 'http-errors';
import type { UploadApiResponse } from 'cloudinary';
import { configureCloudinary } from '../../config/cloudinary.js';
import { getCloudinaryFolder } from '../../config/cloudinary-folders.js';
import { validateProductImage } from './product-images.service.js';
import { enqueueImageCleanup } from './image-cleanup.service.js';

export async function cleanupCatalogImage(publicId?: string) {
  if (!publicId) return;
  try {
    const result: { result?: string } =
      await configureCloudinary().uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      });
    if (result.result === 'ok' || result.result === 'not found') return;
  } catch {
    /* Retry through the existing cleanup worker. */
  }
  try {
    await enqueueImageCleanup([publicId]);
  } catch {
    console.error('Unable to enqueue catalog image cleanup', { publicId });
  }
}
export async function withCatalogImage<T>(
  file: Express.Multer.File | undefined,
  kind: 'brands' | 'categories',
  save: (image?: { url: string; publicId: string }) => Promise<T>,
  oldImage: () => string | undefined = () => undefined
): Promise<T> {
  let uploaded: UploadApiResponse | undefined;
  if (file) {
    validateProductImage(file);
    const storage = configureCloudinary();
    const folder = getCloudinaryFolder(kind);
    uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      try {
        storage.uploader
          .upload_stream(
            {
              folder,
              public_id: randomUUID(),
              resource_type: 'image',
              allowed_formats: ['jpg', 'png', 'webp'],
              overwrite: false,
              timeout: 30000,
              transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
            },
            (error, result) =>
              error || !result
                ? reject(
                    createHttpError(
                      502,
                      'Không thể tải ảnh lên. Vui lòng thử lại.'
                    )
                  )
                : resolve(result)
          )
          .end(file.buffer);
      } catch {
        reject(
          createHttpError(502, 'Không thể tải ảnh lên. Vui lòng thử lại.')
        );
      }
    });
  }
  let result: T;
  try {
    if (
      uploaded &&
      (!uploaded.public_id || !uploaded.secure_url?.startsWith('https://'))
    )
      throw createHttpError(502, 'Dữ liệu ảnh không hợp lệ.');
    result = await save(
      uploaded
        ? { url: uploaded.secure_url, publicId: uploaded.public_id }
        : undefined
    );
    if (uploaded && !result)
      throw createHttpError(404, 'Không tìm thấy nội dung cần cập nhật.');
  } catch (error) {
    if (uploaded?.public_id) await cleanupCatalogImage(uploaded.public_id);
    throw error;
  }
  const previous = oldImage();
  if (previous && previous !== uploaded?.public_id)
    await cleanupCatalogImage(previous);
  return result;
}
