import { Schema, model } from 'mongoose';
const attemptSchema = new Schema(
  {
    phase: { type: String, enum: ['intent', 'answer'] },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'quota', 'failed', 'cancelled'],
      required: true,
    },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
  },
  { _id: false }
);
const schema = new Schema(
  {
    _id: { type: String, required: true },
    kind: {
      type: String,
      enum: ['activation', 'chat', 'provider'],
      default: 'provider',
    },
    stage: { type: String, enum: ['intent', 'answer'], required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'cancelled'],
      required: true,
    },
    attempts: { type: [attemptSchema], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ai_routing_runs', timestamps: true }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ updatedAt: -1 });
export const AiRoutingRun = model('AiRoutingRun', schema);
