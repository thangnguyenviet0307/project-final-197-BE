import { removeUserSecrets } from "../utils/user-mapper.js";
import { Schema, model } from "mongoose";
import type { IUser } from "../types/users.type.js";
export type { IUser } from "../types/users.type.js";

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "staff"],
      default: "staff",
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
      required: true,
    },
    tokenVersion: { type: Number, default: 0, select: false },
    refreshToken: {
      type: String,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const stripSecrets = (_doc: unknown, value: unknown) => removeUserSecrets(value as Record<string, unknown>);
userSchema.set("toJSON", { transform: stripSecrets });
userSchema.set("toObject", { transform: stripSecrets });
export const User = model<IUser>("User", userSchema);
