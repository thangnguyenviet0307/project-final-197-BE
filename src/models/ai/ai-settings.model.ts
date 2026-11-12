import { Schema, model } from 'mongoose';
const connectionSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    provider: {
      type: String,
      enum: ['gemini', 'openai', 'xai'],
      default: 'gemini',
    },
    model: { type: String, required: true },
    encryptedKey: { type: String, required: true, select: false },
    keyHint: { type: String, required: true },
    checkedAt: Date,
    checkedOk: { type: Boolean, default: false },
    checkCode: String,
  },
  { _id: false }
);
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    revision: { type: Number, default: 0 },
    enabled: { type: Boolean, default: false },
    semanticEnabled: { type: Boolean, default: false },
    indexingEnabled: { type: Boolean, default: false },
    riskEnabled: { type: Boolean, default: false },
    dailyCalls: { type: Number, default: 100 },
    activeConnectionId: { type: String, default: null },
    activeEmbeddingGenerationId: { type: String, default: null },
    embeddingEpoch: { type: Number, default: 0 },
    legacyEmbeddingConnectionId: { type: String, default: null },
    connections: { type: [connectionSchema], default: [] },
    audit: {
      type: [
        new Schema(
          { action: String, actor: String, at: Date, connectionId: String },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { collection: 'ai_settings', timestamps: true }
);
export const AiSettings = model('AiSettings', settingsSchema);
