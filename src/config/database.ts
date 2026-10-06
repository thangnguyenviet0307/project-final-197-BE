import mongoose from "mongoose";

export const connectDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(
      process.env['MONGODB_URI'] || "mongodb://localhost:27017/project_final_197"
    );

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};