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
    await mongoose.connect(mongoUri, { autoIndex: process.env['NODE_ENV'] !== 'production' });
    const topology = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (!topology['setName'] && topology['msg'] !== 'isdbgrid') {
      await mongoose.disconnect();
      throw new Error('MongoDB must be a replica set or sharded cluster for transactions');
    }
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed; check connectivity and transaction support");
    throw error;
  }
};
