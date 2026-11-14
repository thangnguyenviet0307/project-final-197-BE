import { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    _id: { type: String, required: true },
    leaseId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ai_activation_leases' }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiActivationLease = model('AiActivationLease', schema);
