// Explicit, additive migration. No dotenv fallback, syncIndexes, index drops or data writes.
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

const comparable = value => {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparable(value[key])]));
  return value;
};
function matchingOptions(actual, expected) {
  return Boolean(actual.unique) === Boolean(expected.unique)
    && Boolean(actual.sparse) === Boolean(expected.sparse)
    && ['partialFilterExpression', 'expireAfterSeconds', 'collation'].every(key =>
      JSON.stringify(comparable(actual[key] ?? null)) === JSON.stringify(comparable(expected[key] ?? null)));
}
export function planIndexes(expectedIndexes, existingIndexes) {
  return expectedIndexes.map(([key, options]) => {
    const sameKey = existingIndexes.filter(index => JSON.stringify(index.key) === JSON.stringify(key));
    const exact = sameKey.find(index => matchingOptions(index, options));
    const name = options.name ?? Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_');
    const conflict = !exact && (sameKey.length > 0 || existingIndexes.some(index => index.name === name));
    return { key, options, name, state: exact ? 'present' : conflict ? 'conflict' : 'missing' };
  });
}

export async function ensureCoreIndexes(args = process.argv.slice(2), environment = process.env) {
  const allowed = new Set(['--database', '--apply', '--confirm-database']);
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.has(flag) || values.has(flag)) throw new Error('Unknown or duplicate index command argument');
    if (flag === '--apply') values.set(flag, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing index command argument value');
      values.set(flag, value);
    }
  }
  const database = values.get('--database');
  if (typeof database !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw new Error('Provide an explicit --database name');
  const apply = values.has('--apply');
  if (apply && values.get('--confirm-database') !== database) throw new Error('Apply requires --confirm-database matching --database');
  if (!environment.MONGODB_URI) throw new Error('Set MONGODB_URI explicitly; this command does not load .env');
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  const [{ User }, { Customer }, { default: Product }, { Order }] = await Promise.all([
    import('../dist/models/users.model.js'), import('../dist/models/customers.model.js'),
    import('../dist/models/products.model.js'), import('../dist/models/orders.model.js'),
  ]);
  try {
    await mongoose.connect(environment.MONGODB_URI, { dbName: database, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    if (mongoose.connection.name !== database) throw new Error('Database selection mismatch');
    const plans = [];
    for (const model of [User, Customer, Product, Order]) {
      let existing;
      try { existing = await model.collection.indexes(); }
      catch (error) { if (error.code !== 26) throw error; existing = []; }
      const indexes = planIndexes(model.schema.indexes(), existing);
      plans.push({ model, indexes });
      console.log(JSON.stringify({ database, mode: apply ? 'apply' : 'dry-run', collection: model.collection.name,
        indexes: indexes.map(({ key, options, name, state }) => ({ key, options, name, state })) }));
    }
    if (plans.some(plan => plan.indexes.some(index => index.state === 'conflict'))) throw new Error('Conflicting index definitions need manual review; no indexes were changed');
    const missing = plans.flatMap(({ model, indexes }) => indexes.filter(index => index.state === 'missing').map(index => ({ model, index })));
    if (!apply) return { mode: 'dry-run', missing: missing.length };
    for (const { model, index } of missing) {
      await model.collection.createIndex(index.key, { ...index.options, name: index.name });
    }
    // Verify all required keys/options rather than assuming createIndex succeeded.
    for (const { model } of plans) {
      const verified = planIndexes(model.schema.indexes(), await model.collection.indexes());
      if (verified.some(index => index.state !== 'present')) throw new Error('Required index verification failed');
    }
    console.log(JSON.stringify({ database, verified: true, created: missing.length }));
    return { mode: 'apply', created: missing.length };
  } finally { await mongoose.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureCoreIndexes().catch(error => {
    // Never print MongoDB error messages/key values or connection credentials.
    console.error(JSON.stringify({ indexCheckFailed: true, errorType: error.name, code: typeof error.code === 'number' ? error.code : null }));
    console.error('Index check failed. Review arguments, connectivity, existing definitions and duplicate data. No indexes or documents are deleted; earlier successful index creations may remain after an apply failure.');
    process.exitCode = 1;
  });
}
