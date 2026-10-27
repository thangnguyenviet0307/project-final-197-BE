import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';

// Deliberately scoped to a legacy unique index on customers.phone only.
// Never call syncIndexes(): unrelated indexes must remain untouched.
export async function inspectPhoneIndexes(collection) {
  const indexes = await collection.indexes();
  return indexes.filter(index => Object.keys(index.key).length === 1 && index.key.phone !== undefined);
}

export async function repairPhoneIndexes(collection, { apply = false } = {}) {
  const indexes = await inspectPhoneIndexes(collection);
  const legacy = indexes.filter(index => index.unique === true);
  if (!apply) return { applied: false, legacy };
  for (const index of legacy) {
    await collection.dropIndex(index.name);
  }
  // Match the non-unique lookup index declared by Customer's current schema.
  await collection.createIndex({ phone: 1 }, { name: 'phone_1' });
  const after = await inspectPhoneIndexes(collection);
  if (after.some(index => index.unique === true)) throw new Error('Unique phone index still exists');
  return { applied: true, legacy, after };
}

async function main() {
  dotenv.config({ quiet: true });
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) {
    throw new Error('Production index changes require explicit --allow-production approval');
  }
  const connection = await mongoose.createConnection(uri, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000,
  }).asPromise();
  try {
    const collection = connection.db.collection('customers');
    const indexes = await inspectPhoneIndexes(collection);
    console.log(JSON.stringify({ database: connection.name, environment: process.env.NODE_ENV ?? 'unset', collection: 'customers', phoneIndexes: indexes, mode: apply ? 'apply' : 'inspect' }, null, 2));
    const result = await repairPhoneIndexes(collection, { apply });
    console.log(JSON.stringify(result, null, 2));
  } finally { await connection.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Do not print connection errors that could contain credentials/host details.
    console.error('Phone index repair failed:', error?.code ?? error?.name ?? 'Unknown error');
    process.exitCode = 1;
  });
}
