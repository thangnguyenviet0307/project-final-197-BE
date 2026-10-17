import mongoose, { type ClientSession } from "mongoose";
import { SystemLock } from "../models/system-locks.model.js";

// Serialize reference mutations across API processes to prevent transaction write skew.
// The lock is updated inside the transaction and is released by commit/abort.
export async function withRelationsTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  // Initialize outside the transaction so concurrent first requests can use the same row.
  try {
    await SystemLock.updateOne({ _id: "relations" }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  } catch (error) {
    if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 11000) throw error;
  }
  return mongoose.connection.transaction(async (session) => {
    await SystemLock.updateOne({ _id: "relations" }, { $inc: { revision: 1 } }, { session });
    return work(session);
  });
}
