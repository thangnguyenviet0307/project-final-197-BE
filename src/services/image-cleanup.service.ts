import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { ImageCleanupJob } from "../models/image-cleanup-jobs.model.js";
import { configureCloudinary } from "../config/cloudinary.js";

export async function enqueueImageCleanup(publicIds: string[], session: ClientSession) {
  const ids = [...new Set(publicIds)];
  if (!ids.length) return;
  await ImageCleanupJob.bulkWrite(ids.map(publicId => ({ updateOne: {
    filter: { publicId }, update: { $setOnInsert: { publicId, runAt: new Date(), leaseUntil: new Date(0), attempts: 0 } }, upsert: true,
  } })), { session });
}
export async function processImageCleanupBatch() {
  // Bounded batch and expiring lease allow retries after crashes and multiple API processes.
  for (let count = 0; count < 10; count++) {
    const now = new Date();
    const leaseToken = randomUUID();
    const job = await ImageCleanupJob.findOneAndUpdate({ runAt: { $lte: now }, leaseUntil: { $lte: now } },
      { $set: { leaseToken, leaseUntil: new Date(now.getTime() + 5 * 60_000) } }, { new: true });
    if (!job) return;
    const claim = { _id: job._id, leaseToken };
    try {
      const result: { result?: string } = await configureCloudinary().uploader.destroy(job.publicId, { resource_type: "image", invalidate: true });
      if (result.result !== "ok" && result.result !== "not found") throw new Error("Storage cleanup pending");
      await ImageCleanupJob.deleteOne(claim);
    } catch {
      const delay = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(job.attempts, 7));
      await ImageCleanupJob.updateOne(claim, { $inc: { attempts: 1 }, $set: { runAt: new Date(Date.now() + delay), leaseUntil: new Date(0) }, $unset: { leaseToken: 1 } });
    }
  }
}
export function startImageCleanupWorker() {
  let active: Promise<void> | null = null;
  const tick = () => {
    if (active) return;
    active = processImageCleanupBatch().catch(() => { console.error("Image cleanup queue unavailable; will retry"); }).finally(() => { active = null; });
  };
  const timer = setInterval(tick, 30_000); timer.unref(); tick();
  return async () => { clearInterval(timer); await active; };
}
