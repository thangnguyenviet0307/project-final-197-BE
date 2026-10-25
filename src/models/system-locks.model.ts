import { Schema, model } from "mongoose";
// Persisted singleton prevents bootstrap races across processes, including after users are deleted.
export const SystemLock = model("SystemLock", new Schema<{ _id: string; revision: number }>({
  _id: { type: String, required: true },
  revision: { type: Number, default: 0 },
}, { versionKey: false, collection: "system_locks" }));
