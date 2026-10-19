import { Schema, model } from "mongoose";

const schema = new Schema({
  publicId: { type: String, required: true, unique: true },
  attempts: { type: Number, default: 0 },
  runAt: { type: Date, default: Date.now, index: true },
  leaseUntil: { type: Date, default: () => new Date(0) },
  leaseToken: String,
}, { timestamps: true, versionKey: false });
export const ImageCleanupJob = model("ImageCleanupJob", schema);
