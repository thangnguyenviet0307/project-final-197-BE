// Dry-run unless --apply is supplied. Never changes product documents.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
dotenv.config({ quiet: true });
const apply = process.argv.includes('--apply');
const deadline = setTimeout(() => { console.error('Index check timed out. Inspect current indexes before retrying.'); process.exit(1); }, 60000);
deadline.unref();
try {
  await mongoose.connect(process.env.MONGODB_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 15000 });
  const products = mongoose.connection.db.collection('products');
  const indexes = await products.indexes();
  const sameKey = index => Object.keys(index.key).length === 1 && index.key['variants.sku'] === 1;
  const obsolete = indexes.filter(index => sameKey(index) && index.unique && !index.sparse && !index.partialFilterExpression);
  const correct = indexes.find(index => sameKey(index) && index.unique && index.sparse && !index.partialFilterExpression);
  const duplicates = await products.aggregate([
    { $unwind: '$variants' }, { $match: { 'variants.sku': { $type: 'string' } } },
    { $group: { _id: { sku: '$variants.sku', product: '$_id' } } },
    { $group: { _id: '$_id.sku', documents: { $sum: 1 } } },
    { $match: { documents: { $gt: 1 } } }, { $count: 'count' },
  ]).toArray();
  const duplicateSkuGroups = duplicates[0]?.count ?? 0;
  console.log(JSON.stringify({ database: mongoose.connection.name, mode: apply ? 'apply' : 'dry-run',
    duplicateSkuGroups, obsoleteIndexes: obsolete.map(index => index.name),
    create: correct ? null : { name: 'variants_sku_unique_sparse', key: { 'variants.sku': 1 }, unique: true, sparse: true },
    order: 'create and confirm replacement before dropping obsolete indexes; do not modify products',
  }));
  if (duplicateSkuGroups) throw new Error('Duplicate variant SKUs require manual review');
  if (apply) {
    const backupRoot = new URL('../.local-backups/', import.meta.url);
    await mkdir(backupRoot, { recursive: true });
    const backup = new URL(`product-indexes-${Date.now()}.json`, backupRoot);
    await writeFile(backup, JSON.stringify({ database: mongoose.connection.name, indexes }, null, 2), { flag: 'wx', mode: 0o600 });
    if (!correct) await products.createIndex({ 'variants.sku': 1 }, { name: 'variants_sku_unique_sparse', unique: true, sparse: true });
    const confirmed = (await products.indexes()).some(index => sameKey(index) && index.unique && index.sparse && !index.partialFilterExpression);
    if (!confirmed) throw new Error('Replacement index not confirmed; retain old indexes');
    for (const index of obsolete) await products.dropIndex(index.name);
    console.log(JSON.stringify({ repaired: true, dropped: obsolete.map(index => index.name), backup: fileURLToPath(backup) }));
  }
} catch (error) {
  console.error(JSON.stringify({ errorType: error.name, code: error.code ?? null, indexRepairFailed: true }));
  process.exitCode = 1;
} finally { clearTimeout(deadline); await mongoose.disconnect(); }
