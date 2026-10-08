import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';

export interface IBrand extends Document {
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const brandSchema = new Schema<IBrand>(
  {
    name: {
      type: String,
      required: [true, 'Brand name is required'],
      unique: true,
      trim: true,
      minlength: [1, 'Brand name cannot be empty'],
      maxlength: [100, 'Brand name is too long'],
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const BrandModel = mongoose.model<IBrand>(
  'Brand',
  brandSchema
);