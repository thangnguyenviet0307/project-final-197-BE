import { Schema, model } from "mongoose";
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 255 },
  description: { type: String, trim: true, maxlength: 500, default: "" },
  isActive: { type: Boolean, default: true },
}, { collection: "categories_post", timestamps: true, optimisticConcurrency: true });
schema.index({ slug: 1 }, { unique: true });
export const PostCategory = model("PostCategory", schema);
