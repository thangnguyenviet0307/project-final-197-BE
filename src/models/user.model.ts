import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
  fullName: string;
  email: string;
  password?: string;
  phone?: string;
  role: "admin" | "staff"; 
  status: "active" | "inactive"; 
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
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
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "staff"],
      default: "staff",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active", 
      required: true,
    },
  },
  {
    timestamps: true, 
    versionKey: false, 
  }
);

userSchema.methods['toJSON'] = function () {
  const userObject = (this as any).toObject();
  delete userObject.password;
  return userObject;
};

export const User = model<IUser>("User", userSchema);