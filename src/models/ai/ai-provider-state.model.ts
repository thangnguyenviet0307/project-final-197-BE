import { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    _id: { type: String, required: true },
    until: { type: Date, required: true },
    reason: { type: String, enum: ['rate', 'daily'], required: true },
  },
  { collection: 'ai_provider_states', timestamps: true }
);
schema.index({ until: 1 }, { expireAfterSeconds: 0 });
export const AiProviderState = model('AiProviderState', schema);
