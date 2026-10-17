import multer from "multer";
import type { RequestHandler } from "express";
import createHttpError from "http-errors";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(createHttpError(415, "Choose a JPG, PNG or WebP image"));
      return;
    }
    callback(null, true);
  },
}).single("image");

export const parseProductImage: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(createHttpError(error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
        error.code === "LIMIT_FILE_SIZE" ? "Product image must not exceed 5 MB" : "Send one image in the image field"));
      return;
    }
    next(error);
  });
};
