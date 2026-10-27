import mongoose from "mongoose";
import type { ICategories } from "../types/categories.js";

// Create a schema for the category model
const categoriesSchema = new mongoose.Schema<ICategories>(
  {
    seedBatch: { type: String, immutable: true, select: false, match: /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true },
    description: { type: String },
    icon: { type: String },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Categories"},
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "categories",
  },
);

export const Categories = mongoose.model<ICategories>("Categories", categoriesSchema);