import { Schema, model } from 'mongoose';

// Queue the same bounded intent for every valid address, including unknown ones.
// Generate the OTP only in the worker: never persist a plaintext OTP or password.
const schema = new Schema(
  {
    email: { type: String, required: true },
    runAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    leaseUntil: { type: Date, default: () => new Date(0) },
    leaseToken: String,
  },
  { versionKey: false, collection: 'customer_otp_jobs' }
);
schema.index({ runAt: 1, leaseUntil: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CustomerOtpJob = model('CustomerOtpJob', schema);
