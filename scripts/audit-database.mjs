// Read-only: never creates indexes or removes historical soft-deleted records.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { readdir } from 'node:fs/promises';

dotenv.config({ quiet: true });
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const deadline = setTimeout(() => {
  console.error('Read-only audit timed out; production indexes remain unconfirmed.');
  process.exit(1);
}, 25000);
deadline.unref();
try {
  for (const file of await readdir(new URL('../src/models/', import.meta.url))) {
    if (file.endsWith('.model.ts')) await import(new URL(`../dist/models/${file.replace(/\.ts$/, '.js')}`, import.meta.url));
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  console.log(JSON.stringify({ database: mongoose.connection.name, mode: 'read-only' }));
  for (const model of Object.values(mongoose.models)) {
    const collection = model.collection;
    let indexes;
    try { indexes = await collection.indexes(); }
    catch (error) { if (error.code === 26) indexes = []; else throw error; }
    const uniqueIndexes = model.schema.indexes().filter(([, options]) => options.unique).map(([key, options]) => ({
      key,
      actual: indexes.filter(index => JSON.stringify(index.key) === JSON.stringify(key)).map(index => ({ unique: !!index.unique, sparse: !!index.sparse, partialFilterExpression: index.partialFilterExpression ?? null })),
      confirmed: indexes.some(index => index.unique && JSON.stringify(index.key) === JSON.stringify(key)
        && !!index.sparse === !!options.sparse
        && JSON.stringify(index.partialFilterExpression ?? {}) === JSON.stringify(options.partialFilterExpression ?? {})),
    }));
    console.log(JSON.stringify({ collection: collection.name, uniqueIndexes,
      documents: await collection.countDocuments({}),
      softDeleted: await collection.countDocuments({ isDeleted: true }),
    }));
  }
} catch (error) {
  console.error(JSON.stringify({ errorType: error.name, code: error.code ?? null }));
  console.error('Read-only audit failed. Check database connectivity, read permissions and compiled models. No database writes were requested.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); await mongoose.disconnect(); }
