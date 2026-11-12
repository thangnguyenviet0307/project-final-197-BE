import { Schema, model } from 'mongoose';
const generationSchema = new Schema(
  {
    _id: { type: String, required: true },
    connectionId: { type: String, required: true },
    provider: { type: String, enum: ['gemini', 'openai'], required: true },
    model: { type: String, required: true },
    dimensions: { type: Number, required: true },
    indexName: { type: String, required: true },
    indexId: String,
    state: {
      type: String,
      enum: ['queued', 'building', 'verifying', 'ready', 'failed', 'cancelled'],
      default: 'queued',
    },
    revision: { type: Number, default: 0 },
    leaseId: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    nextRunAt: { type: Date, default: Date.now },
    chunks: { type: Number, default: 0 },
    verified: { type: Number, default: 0 },
    failureCode: String,
    finishedAt: Date,
    lastDeactivatedAt: Date,
    autoActivate: { type: Boolean, default: false },
    parentEpoch: { type: Number, default: 0 },
    parentId: { type: String, default: null },
    createdBy: { type: String, required: true },
  },
  { collection: 'ai_embedding_generations', timestamps: true }
);
generationSchema.index({ state: 1, nextRunAt: 1 });
export const AiEmbeddingGeneration = model(
  'AiEmbeddingGeneration',
  generationSchema
);
const chunkSchema = new Schema(
  {
    generation: { type: String, required: true },
    key: { type: String, required: true },
    part: { type: Number, required: true },
    hash: { type: String, required: true },
    text: { type: String, required: true },
    title: String,
    href: String,
    embedding: { type: [Number], required: true, select: false },
    scanToken: String,
    verified: { type: Boolean, default: false },
  },
  { collection: 'ai_embedding_chunks', timestamps: true }
);
chunkSchema.index({ generation: 1, key: 1, part: 1 }, { unique: true });
chunkSchema.index({ hash: 1, generation: 1 });
export const AiEmbeddingChunk = model('AiEmbeddingChunk', chunkSchema);
