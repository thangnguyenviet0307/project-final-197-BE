import { v2 as cloudinary } from "cloudinary";
import createHttpError from "http-errors";

// Read credentials only on the server. Missing media configuration does not prevent login/startup.
export function configureCloudinary() {
  const cloud_name = process.env["CLOUDINARY_CLOUD_NAME"];
  const api_key = process.env["CLOUDINARY_API_KEY"];
  const api_secret = process.env["CLOUDINARY_API_SECRET"];
  if (!cloud_name || !api_key || !api_secret) throw createHttpError(503, "Image storage is not configured. Contact your administrator.");
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  return cloudinary;
}
