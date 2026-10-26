import { Schema, model } from "mongoose";

const reviewSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  comment: { type: String, required: true, trim: true, maxlength: 2000 },
  reviewerName: { type: String, required: true, trim: true, maxlength: 100 },
  date: { type: Date, default: Date.now },
  source: { type: String, enum: ["admin", "dummyjson"], required: true },
}, { timestamps: true });
reviewSchema.index({ product: 1, date: -1, _id: -1 });
export const ProductReview = model("ProductReview", reviewSchema);
