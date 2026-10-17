import { randomUUID } from "node:crypto";
import createHttpError from "http-errors";
import { configureCloudinary } from "../config/cloudinary.js";
import Product from "../models/products.model.js";
import type { UploadApiResponse } from "cloudinary";

export function validateProductImage(file: Express.Multer.File) {
  const data = file.buffer;
  if (data.length > 5 * 1024 * 1024) throw createHttpError(413, "Product image must not exceed 5 MB");
  const valid = (file.mimetype === "image/jpeg" && data[0] === 255 && data[1] === 216 && data[2] === 255) ||
    (file.mimetype === "image/png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimetype === "image/webp" && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP");
  if (!valid) throw createHttpError(400, "Image content does not match its type");
}

export async function addProductImage(id: string, file?: Express.Multer.File) {
  if (!file) throw createHttpError(400, "Select an image to upload");
  validateProductImage(file);
  const storage = configureCloudinary();
  const product = await Product.findById(id);
  if (!product) throw createHttpError(404, "Product not found");
  if (product.images.length >= 8) throw createHttpError(409, "A product can have up to 8 images");
  const folder = (process.env["CLOUDINARY_PRODUCT_FOLDER"] || "project-final/products").replace(/^\/+|\/+$/g, "");
  if (!/^[a-zA-Z0-9_/-]{1,80}$/.test(folder)) throw createHttpError(503, "Invalid image folder configuration");
  const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
    try {
      const stream = storage.uploader.upload_stream({
        folder: `${folder}/${id}`, public_id: randomUUID(), resource_type: "image",
        allowed_formats: ["jpg", "png", "webp"], overwrite: false, timeout: 30_000,
        transformation: [{ width: 1600, height: 1600, crop: "limit" }],
      }, (error, result) => {
        if (error || !result) reject(createHttpError(502, "Image storage upload failed. Please try again."));
        else resolve(result);
      });
      stream.end(file.buffer);
    } catch { reject(createHttpError(502, "Image storage upload failed. Please try again.")); }
  });
  try {
    if (!uploaded.public_id || !uploaded.secure_url?.startsWith("https://")) throw createHttpError(502, "Invalid image storage response");
    product.images.push({ public_id: uploaded.public_id, secure_url: uploaded.secure_url,
      width: uploaded.width, height: uploaded.height, format: uploaded.format });
    if (!product.thumbnail) product.thumbnail = uploaded.secure_url;
    await product.save(); // Optimistic concurrency prevents concurrent uploads overwriting the gallery.
    return product.toObject();
  } catch (error) {
    // Do not leave a newly uploaded asset behind when MongoDB rejects the write.
    if (uploaded.public_id) {
      try { await storage.uploader.destroy(uploaded.public_id, { resource_type: "image", invalidate: true }); }
      catch { console.error("Failed to clean up unlinked product image", { publicId: uploaded.public_id }); }
    }
    throw error;
  }
}
