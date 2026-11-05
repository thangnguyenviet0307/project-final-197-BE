import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import { warrantyStatuses } from '../validations/support.validation.js';
import { publicationSchema } from './publication.schema.js';

const contentSchema = new Schema(
  {
    privacy: { type: String, default: '', maxlength: 30000 },
    warranty: { type: String, default: '', maxlength: 30000 },
    returns: { type: String, default: '', maxlength: 30000 },
    shipping: { type: String, default: '', maxlength: 30000 },
    payment: { type: String, default: '', maxlength: 30000 },
    support: { type: String, default: '', maxlength: 30000 },
  },
  { _id: false }
);
export const StorePolicy = model(
  'StorePolicy',
  new Schema(
    {
      _id: { type: String, required: true },
      content: { type: contentSchema, required: true },
      publishedContent: { type: contentSchema, default: null },
      publishedAt: { type: Date, default: null },
      publications: {
        privacy: publicationSchema,
        warranty: publicationSchema,
        returns: publicationSchema,
        shipping: publicationSchema,
        payment: publicationSchema,
        support: publicationSchema,
      },
    },
    {
      timestamps: true,
      collection: 'store_policies',
      optimisticConcurrency: true,
    }
  )
);

const historySchema = new Schema(
  {
    status: { type: String, enum: warrantyStatuses, required: true },
    note: { type: String, required: true, maxlength: 1000 },
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorType: { type: String, enum: ['customer', 'user'], required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);
const warrantySchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, default: '' },
    orderId: { type: Schema.Types.ObjectId, required: true },
    orderCode: { type: String, required: true },
    itemIndex: { type: Number, required: true },
    productName: { type: String, required: true },
    variantName: { type: String, default: '' },
    description: { type: String, required: true, maxlength: 3000 },
    fingerprint: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: warrantyStatuses,
      default: 'submitted',
      required: true,
    },
    handlerId: { type: Schema.Types.ObjectId, default: null },
    handlerName: { type: String, default: '', maxlength: 101 },
    images: {
      type: [
        new Schema({
          publicId: { type: String, required: true },
          format: { type: String, required: true },
          digest: { type: String, required: true },
        }),
      ],
      default: [],
    },
    history: { type: [historySchema], required: true },
  },
  {
    timestamps: true,
    collection: 'warranty_requests',
    optimisticConcurrency: true,
  }
);
warrantySchema.index({ orderId: 1 });
warrantySchema.index({ customerId: 1, createdAt: -1, _id: -1 });
warrantySchema.index({ status: 1, createdAt: -1, _id: -1 });
export const WarrantyRequest = model('WarrantyRequest', warrantySchema);
export type WarrantyDocument = HydratedDocument<
  InferSchemaType<typeof warrantySchema>
>;
