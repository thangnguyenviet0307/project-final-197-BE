import { model, Schema } from "mongoose";
import type { IBrand } from "../types/brands.js";

const brandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true },
    description: { type: String },
    logoUrl: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "brands",
  },
);

export const BrandModel = model<IBrand>("Brand", brandSchema);
