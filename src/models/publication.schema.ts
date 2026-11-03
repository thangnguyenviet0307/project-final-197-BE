import { Schema } from 'mongoose';

export const publicationSchema = new Schema(
  {
    publishedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null },
    views: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);
