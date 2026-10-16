import { Schema, model } from 'mongoose';
import type { IUser } from '../types/user.type.js';

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password: { type: String, required: true, select: false },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    role: { type: String, enum: ['admin', 'staff'], required: true, default: 'staff' },
    active: { type: Boolean, default: true },
    refreshToken: { type: String, select: false, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'users',
  },
);

userSchema.index({ role: 1 });
userSchema.index({ active: 1 });

export const User = model<IUser>('User', userSchema);