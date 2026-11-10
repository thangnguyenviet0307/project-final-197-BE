import mongoose from 'mongoose';

const collections = [
  'products', 'categories', 'brands', 'orders', 'users', 'customers',
  'guest_contacts', 'hero_slides', 'posts', 'categories_post',
  'product_reviews', 'store_policies', 'store_information', 'warranty_requests',
];
const ignoredFields = new Set([
  'updatedAt', 'refreshToken', 'tokenVersion', 'password', 'emailVerification',
  'pendingPassword', 'passwordRecovery', 'viewCount',
]);

export function isBusinessChange(change: {
  operationType: string;
  ns?: { db?: string; coll?: string };
  updateDescription?: {
    updatedFields?: Record<string, unknown>;
    removedFields?: string[];
    truncatedArrays?: { field: string; newSize: number }[];
  };
}): boolean {
  if (!change.ns?.coll || !collections.includes(change.ns.coll)) return false;
  if (['insert', 'replace', 'delete'].includes(change.operationType)) return true;
  if (change.operationType !== 'update') return false;
  const fields = [
    ...Object.keys(change.updateDescription?.updatedFields ?? {}),
    ...(change.updateDescription?.removedFields ?? []),
    ...(change.updateDescription?.truncatedArrays ?? []).map(array => array.field),
  ];
  return fields.some(field => !ignoredFields.has(field.split('.')[0] ?? ''));
}

// One database change stream per API instance, shared by its connected admins.
// Each instance watches MongoDB, so writes through other instances are visible too.
export function subscribeToDataChanges(changed: () => void, failed: () => void) {
  const listener = { changed, failed };
  listeners.add(listener);
  if (!stream) {
    try {
      stream = mongoose.connection.watch([
        { $match: { 'ns.coll': { $in: collections }, operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } },
        { $project: { operationType: 1, ns: 1, updateDescription: 1 } },
      ]);
      stream.on('change', change => {
        if (isBusinessChange(change)) {
          for (const subscriber of listeners) subscriber.changed();
        }
      });
      stream.on('error', stopFailedStream);
      stream.on('close', stopFailedStream);
    } catch {
      stopFailedStream();
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stream) {
      const previous = stream;
      stream = null;
      previous.removeAllListeners();
      void previous.close().catch(() => {});
    }
  };
}

const listeners = new Set<{ changed: () => void; failed: () => void }>();
let stream: ReturnType<typeof mongoose.connection.watch> | null = null;
function stopFailedStream() {
  const previous = stream;
  stream = null;
  previous?.removeAllListeners();
  void previous?.close().catch(() => {});
  const subscribers = [...listeners];
  listeners.clear();
  for (const subscriber of subscribers) subscriber.failed();
}
