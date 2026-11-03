import { Schema, model } from 'mongoose';
import { publicationSchema } from './publication.schema.js';

export const StoreInformation = model(
  'StoreInformation',
  new Schema(
    {
      _id: { type: String, required: true },
      content: { type: String, default: '', maxlength: 30000 },
      publishedContent: { type: String, default: null, maxlength: 30000 },
      publishedAt: { type: Date, default: null },
      publication: { type: publicationSchema, default: undefined },
    },
    {
      timestamps: true,
      collection: 'store_information',
      optimisticConcurrency: true,
    }
  )
);
