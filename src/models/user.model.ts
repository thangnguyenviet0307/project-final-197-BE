import { Schema, model, type Document } from "mongoose";

export interface IUser extends Document {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: "admin" | "staff";
  active: boolean;
  tokenVersion: number;
  refreshToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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

userSchema.set("toJSON", { transform: (_doc, ret) => {
  const output = ret as unknown as Record<string, unknown>;
  delete output["password"];
  delete output["refreshToken"];
  delete output["tokenVersion"];
  return output;
} });
userSchema.set("toObject", { transform: (_doc, ret) => {
  const output = ret as unknown as Record<string, unknown>;
  delete output["password"];
  delete output["refreshToken"];
  delete output["tokenVersion"];
  return output;
} });
export const User = model<IUser>("User", userSchema);
