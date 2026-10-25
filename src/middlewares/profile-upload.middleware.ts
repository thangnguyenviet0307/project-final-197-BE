import multer from "multer";
import createHttpError from "http-errors";
import type { RequestHandler } from "express";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 800 * 1024, files: 1, fields: 7, fieldSize: 4096 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.mimetype)) {
      callback(createHttpError(415, "Avatar must be JPG, PNG or GIF"));
      return;
    }
    callback(null, true);
  },
}).single("avatar");

export const parseProfileUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(createHttpError(error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
        error.code === "LIMIT_FILE_SIZE" ? "Avatar must not exceed 800 KB" : "Invalid profile upload"));
      return;
    }
    next(error);
  });
};
