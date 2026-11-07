import mongoose from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

export const collectionRenames = Object.freeze([
  { from: 'productreviews', to: 'product_reviews' },
  { from: 'imagecleanupjobs', to: 'image_cleanup_jobs' },
]);

export function planCollectionRenames(names) {
  const existing = new Set(names);
  return collectionRenames.map((mapping) => ({
    ...mapping,
    state: existing.has(mapping.from)
      ? existing.has(mapping.to)
        ? 'conflict'
        : 'rename'
      : existing.has(mapping.to)
        ? 'already_renamed'
        : 'not_created',
  }));
}

const comparableIndexes = (indexes) =>
  indexes
    .map(({ ns: _oldNamespace, ...index }) => index)
    .sort((a, b) => a.name.localeCompare(b.name));

export async function renameCollections(
  args = process.argv.slice(2),
  environment = process.env
) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (
      !['--database', '--confirm-database', '--apply'].includes(flag) ||
      values.has(flag)
    )
      throw new Error('Unknown or duplicate argument');
    if (flag === '--apply') values.set(flag, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith('--'))
        throw new Error('Missing argument value');
      values.set(flag, value);
    }
  }
  const database = values.get('--database');
  const apply = values.has('--apply');
  if (typeof database !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(database))
    throw new Error('Provide the exact --database name');
  if (apply && values.get('--confirm-database') !== database)
    throw new Error('Apply requires a matching --confirm-database');
  if (!environment.MONGODB_URI) throw new Error('MONGODB_URI is required');
  try {
    await mongoose.connect(environment.MONGODB_URI, {
      dbName: database,
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const plan = planCollectionRenames(collections.map((item) => item.name));
    const snapshots = new Map();
    for (const item of plan.filter((item) => item.state === 'rename')) {
      const collection = db.collection(item.from);
      snapshots.set(item.from, {
        metadata: collections.find((info) => info.name === item.from),
        count: await collection.countDocuments({}),
        indexes: comparableIndexes(await collection.indexes()),
      });
    }
    console.log(
      JSON.stringify(
        {
          database,
          mode: apply ? 'apply' : 'dry-run',
          plan: plan.map((item) => ({
            ...item,
            ...(snapshots.has(item.from)
              ? { documents: snapshots.get(item.from).count }
              : {}),
          })),
        },
        null,
        2
      )
    );
    if (plan.some((item) => item.state === 'conflict'))
      throw new Error(
        'Both source and destination exist; no collections were changed'
      );
    if (!apply) return plan;
    for (const item of plan.filter((item) => item.state === 'rename')) {
      const before = snapshots.get(item.from);
      const current = await db.listCollections({ name: item.from }).next();
      if (
        !isDeepStrictEqual(current?.info?.uuid, before.metadata.info?.uuid) ||
        (await db.collection(item.from).countDocuments({})) !== before.count
      )
        throw new Error(
          'Source changed since inspection; stop old API/workers before retrying'
        );
      await db.collection(item.from).rename(item.to, { dropTarget: false });
      const after = await db.listCollections({ name: item.to }).next();
      const indexes = comparableIndexes(await db.collection(item.to).indexes());
      if (
        !after ||
        !isDeepStrictEqual(after.info?.uuid, before.metadata.info?.uuid) ||
        !isDeepStrictEqual(after.options, before.metadata.options) ||
        (await db.collection(item.to).countDocuments({})) !== before.count ||
        !isDeepStrictEqual(indexes, before.indexes) ||
        (await db.listCollections({ name: item.from }).hasNext())
      )
        throw new Error(
          'Post-rename verification failed; inspect state before retrying'
        );
      console.log(
        JSON.stringify({
          from: item.from,
          to: item.to,
          verified: true,
          documents: before.count,
          indexes: indexes.length,
          collectionIdentityPreserved: true,
        })
      );
    }
    return plan;
  } finally {
    await mongoose.disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  renameCollections().catch((error) => {
    console.error(
      JSON.stringify({
        renameFailed: true,
        errorType: error.name,
        code: typeof error.code === 'number' ? error.code : null,
      })
    );
    console.error(
      'Rename stopped. Inspect conflicts/state before retrying; earlier verified renames may remain. No destination is dropped or overwritten.'
    );
    process.exitCode = 1;
  });
}
