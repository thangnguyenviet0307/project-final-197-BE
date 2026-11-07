import { Schema, model } from 'mongoose';
const sourceSchema = new Schema(
  { key: String, title: String, href: String },
  { _id: false }
);
const conversationSchema = new Schema(
  {
    ownerKind: { type: String, enum: ['guest', 'customer'], required: true },
    ownerId: { type: String, required: true },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    lastActivityAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    busyUntil: { type: Date, default: null },
    activeRequestId: { type: String, default: null },
  },
  { collection: 'ai_conversations', timestamps: true }
);
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
conversationSchema.index({ ownerKind: 1, ownerId: 1, lastActivityAt: -1 });
export const AiConversation = model('AiConversation', conversationSchema);
const turnSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    requestId: { type: String, required: true },
    content: { type: String, required: true, maxlength: 2000 },
    answer: { type: String, default: '', maxlength: 16000 },
    status: {
      type: String,
      enum: ['processing', 'completed', 'cancelled', 'failed'],
      default: 'processing',
    },
    sources: { type: [sourceSchema], default: [] },
    productSlugs: { type: [String], default: [] },
    productIds: { type: [Schema.Types.ObjectId], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ai_messages', timestamps: true }
);
turnSchema.index({ conversationId: 1, requestId: 1 }, { unique: true });
turnSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
turnSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
export const AiTurn = model('AiTurn', turnSchema);
const ticketSchema = new Schema(
  {
    _id: String,
    ownerKind: { type: String, enum: ['guest', 'customer'], required: true },
    ownerId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ai_socket_tickets' }
);
ticketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiSocketTicket = model('AiSocketTicket', ticketSchema);
const chunkSchema = new Schema(
  {
    key: { type: String, required: true },
    part: { type: Number, required: true },
    hash: { type: String, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [], select: false },
    embeddingModel: String,
    title: String,
    href: String,
  },
  { collection: 'ai_knowledge_chunks', timestamps: true }
);
chunkSchema.index({ key: 1, part: 1 }, { unique: true });
export const AiChunk = model('AiChunk', chunkSchema);
const counterSchema = new Schema(
  {
    _id: String,
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ai_usage_counters' }
);
counterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiCounter = model('AiCounter', counterSchema);
const riskSchema = new Schema(
  {
    actorHash: String,
    event: String,
    reason: String,
    score: Number,
    dedupeKey: String,
    occurrences: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ai_risk_events', timestamps: true }
);
riskSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
riskSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);
export const AiRiskEvent = model('AiRiskEvent', riskSchema);
const indexJobSchema = new Schema(
  {
    _id: String,
    state: { type: String, default: 'queued' },
    attempts: { type: Number, default: 0 },
    leaseUntil: { type: Date, default: null },
    lastSuccessAt: Date,
    nextRunAt: { type: Date, required: true },
    requestedAt: Date,
  },
  { collection: 'ai_knowledge_index_jobs', timestamps: true }
);
export const AiIndexJob = model('AiIndexJob', indexJobSchema);
export const aiModels = [
  AiConversation,
  AiTurn,
  AiSocketTicket,
  AiChunk,
  AiCounter,
  AiRiskEvent,
  AiIndexJob,
];
