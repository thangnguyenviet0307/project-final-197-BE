import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

export const connectDatabase = async (): Promise<void> => {
  const mongoUri = process.env["MONGODB_URI"];

  if (!mongoUri) {
    throw new Error(
      "MONGODB_URI is not defined. Please add it to your .env file.",
    );
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};
