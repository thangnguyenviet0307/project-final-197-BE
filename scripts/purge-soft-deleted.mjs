import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ quiet: true });
const backupRoot = fileURLToPath(new URL('../.local-backups/', import.meta.url));
const EJSON = mongoose.mongo.BSON.EJSON;
const marker = { $or: [{ isDeleted: true }, { is_deleted: true }, { deleted: true }, { deletedAt: { $type: 'date' } }] };
const apply = process.argv.includes('--apply');
const planArgument = process.argv.find(value => value.startsWith('--plan='))?.slice(7);
const deadline = setTimeout(() => { console.error('Database cleanup timed out; verify the archived IDs before retrying.'); process.exit(1); }, 30000);
deadline.unref();

try {
  await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  if (apply) {
    if (!planArgument) throw new Error('Apply requires an existing archived plan');
    const planPath = path.resolve(planArgument);
    if (path.dirname(planPath) !== path.resolve(backupRoot)) throw new Error('Plan must be inside .local-backups');
    const plan = EJSON.parse(await readFile(planPath, 'utf8'));
    if (plan.database !== db.databaseName || plan.collection !== 'brands' || !Array.isArray(plan.documents)) throw new Error('Unexpected database or cleanup plan');
    const ids = plan.documents.map(doc => doc._id);
    const session = await mongoose.startSession();
    let deleted = 0;
    try {
      await session.withTransaction(async () => {
        await db.collection('system_locks').updateOne({ _id: 'relations' }, { $inc: { revision: 1 } }, { upsert: true, session });
        const current = await db.collection('brands').find({ _id: { $in: ids } }, { session }).toArray();
        if (current.length !== plan.documents.length) throw new Error('Candidate count changed; create a new plan');
        const originals = new Map(plan.documents.map(doc => [String(doc._id), EJSON.stringify(doc)]));
        if (current.some(doc => doc.isDeleted !== true || EJSON.stringify(doc) !== originals.get(String(doc._id)))) throw new Error('Candidate changed; create a new plan');
        if (await db.collection('products').countDocuments({ brand: { $in: ids } }, { session })) throw new Error('Products still reference a candidate brand');
        const result = await db.collection('brands').deleteMany({ _id: { $in: ids }, isDeleted: true }, { session });
        if (result.deletedCount !== ids.length) throw new Error('Delete count mismatch');
        deleted = result.deletedCount;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
    console.log(JSON.stringify({ database: db.databaseName, collection: 'brands', deleted, remainingPlannedIds: await db.collection('brands').countDocuments({ _id: { $in: ids } }), backup: planPath }));
  } else {
    for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
      const count = await db.collection(collection.name).countDocuments(marker);
      console.log(JSON.stringify({ collection: collection.name, softDeleted: count }));
    }
    const documents = await db.collection('brands').find({ isDeleted: true }).sort({ _id: 1 }).toArray();
    const references = await db.collection('products').countDocuments({ brand: { $in: documents.map(doc => doc._id) } });
    await mkdir(backupRoot, { recursive: true });
    const planPath = path.join(backupRoot, `soft-deleted-brands-${Date.now()}.ejson`);
    await writeFile(planPath, EJSON.stringify({ database: db.databaseName, collection: 'brands', documents, archivedAt: new Date() }), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ mode: 'dry-run', database: db.databaseName, candidates: documents.length, referencedProducts: references, backup: planPath }));
    if (references) process.exitCode = 1;
  }
} catch (error) {
  // Controlled messages only; driver errors can contain connection details.
  console.error(JSON.stringify({ errorType: error.name, code: error.code ?? null, cleanupFailed: true }));
  process.exitCode = 1;
} finally { clearTimeout(deadline); await mongoose.disconnect(); }
