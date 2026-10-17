import { Schema, model } from "mongoose";
// Persisted singleton prevents bootstrap races across processes, including after users are deleted.
export const SystemLock = model("SystemLock", new Schema<{ _id: string }>({
  _id: { type: String, required: true },
}, { versionKey: false, collection: "system_locks" }));
