import multer from 'multer';
import createHttpError from 'http-errors';
import type { RequestHandler } from 'express';

const parse = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 5 * 1024 * 1024,
    fields: 8,
    fieldSize: 512 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(createHttpError(415, 'Chọn ảnh JPG, PNG hoặc WebP.'));
      return;
    }
    callback(null, true);
  },
}).single('image');
export const parseCatalogImage: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }
  parse(req, res, (error) => {
    if (error) {
      next(
        error instanceof multer.MulterError
          ? createHttpError(
              error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
              error.code === 'LIMIT_FILE_SIZE'
                ? 'Ảnh tối đa 5 MB.'
                : 'Gửi một ảnh trong trường image và các trường dữ liệu hợp lệ.'
            )
          : error
      );
      return;
    }
    if (req.body.isActive === 'true') req.body.isActive = true;
    else if (req.body.isActive === 'false') req.body.isActive = false;
    if (req.body.parent === '' || req.body.parent === 'null')
      req.body.parent = null;
    // File-only edits still use the ordinary strict update schema; the stored URL is set from Cloudinary.
    if (req.file && Object.keys(req.body).length === 0)
      req.body[req.baseUrl.endsWith('/brands') ? 'logoUrl' : 'icon'] = '';
    next();
  });
};
