import { model, Schema } from "mongoose";

const schema = new Schema(
  {
    category: {
      type: Schema.Types.ObjectId,
      ref: "Categories",
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    imageUrl: { type: String, maxlength: 2048, default: null },
    sortOrder: {
      type: Number,
      min: 0,
      max: 10000,
      default: 0,
      validate: Number.isSafeInteger,
    },
    isActive: { type: Boolean, default: true },
  },
  { collection: "hero_slides", timestamps: true, optimisticConcurrency: true },
);
schema.index({ isActive: 1, sortOrder: 1, _id: 1 });
export const HeroSlide = model("HeroSlide", schema);
