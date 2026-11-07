import { Schema } from 'mongoose';

export interface SecurityChallenge {
  id: string;
  hash?: string;
  email: string;
  version: number;
  status: 'pending' | 'active' | 'consumed';
  expiresAt: Date;
  resendAt: Date;
  attempts: number;
  resetHash?: string;
  resetExpiresAt?: Date;
}

export const securityChallengeSchema = new Schema<SecurityChallenge>(
  {
    id: { type: String, required: true },
    hash: String,
    email: { type: String, required: true },
    version: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'consumed'],
      required: true,
    },
    expiresAt: { type: Date, required: true },
    resendAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resetHash: String,
    resetExpiresAt: Date,
  },
  { _id: false }
);
