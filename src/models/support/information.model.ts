import { LONG_TEXT_MAX_LENGTH } from '../../config/text-limits.js';
import { Schema, model } from 'mongoose';
import { publicationSchema } from './publication.schema.js';

export const StoreInformation = model(
  'StoreInformation',
  new Schema(
    {
      _id: { type: String, required: true },
      content: { type: String, default: '', maxlength: LONG_TEXT_MAX_LENGTH },
      publishedContent: { type: String, default: null, maxlength: LONG_TEXT_MAX_LENGTH },
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
