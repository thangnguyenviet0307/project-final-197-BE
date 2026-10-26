import 'dotenv/config';
import mongoose from 'mongoose';
import { createNameAllocator, cleanLegacySeedName } from './names.js';
import { formatSeedError } from './errors.js';

interface CatalogRecord {
  _id: mongoose.Types.ObjectId;
  name?: string;
  product_name?: string;
  slug: string;
}

async function main() {
  if (process.env['NODE_ENV'] === 'production') throw new Error('Seed cleanup is disabled in production.');
  const uri = process.env['MONGODB_URI']?.trim();
  if (!uri) throw new Error('Set MONGODB_URI in .env.');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const database = mongoose.connection.db;
  if (!database) throw new Error('MongoDB connection is not ready.');
  const plan: {
    collection: string; field: 'name' | 'product_name'; id: mongoose.Types.ObjectId;
    oldName: string; oldSlug: string; name: string; slug: string;
  }[] = [];
  for (const collection of ['brands', 'categories', 'products']) {
    const field = collection === 'products' ? 'product_name' : 'name';
    const records = await database.collection<CatalogRecord>(collection)
      .find({}, { projection: { [field]: 1, slug: 1 } }).sort({ _id: 1 }).toArray();
    const reserved = records.map(record => ({ name: record[field] ?? '', slug: record.slug ?? '' }));
    for (const [index, record] of records.entries()) {
      const oldName = record[field];
      if (!oldName || !record.slug) continue;
      const base = cleanLegacySeedName(oldName, record.slug);
      if (!base) continue;
      // Exclude this record so a slug-only repair does not rename its valid name.
      const allocate = createNameAllocator(reserved.filter((_, position) => position !== index), collection === 'brands' ? 100 : 255);
      const identity = allocate(base);
      reserved[index] = identity;
      plan.push({ collection, field, id: record._id, oldName, oldSlug: record.slug, ...identity });
    }
  }
  console.table(plan.map(change => ({ collection: change.collection, before: change.oldName, after: change.name, slug: change.slug })));
  if (!process.argv.includes('--apply')) {
    console.log(`Preview only: ${plan.length} records. Run with --apply to save these changes.`);
    return;
  }
  await mongoose.connection.transaction(async session => {
    for (const change of plan) {
      const result = await database.collection<CatalogRecord>(change.collection).updateOne(
        { _id: change.id, [change.field]: change.oldName, slug: change.oldSlug },
        { $set: { [change.field]: change.name, slug: change.slug }, $inc: { __v: 1 } }, { session },
      );
      if (result.matchedCount !== 1) throw new Error('Catalog changed during cleanup; rerun the preview.');
      if (change.collection === 'products') {
        await database.collection('orders').updateMany(
          { orderItems: { $elemMatch: { productId: change.id, productName: change.oldName } } },
          { $set: { 'orderItems.$[item].productName': change.name } },
          { session, arrayFilters: [{ 'item.productId': change.id, 'item.productName': change.oldName }] },
        );
      }
    }
  });
  console.log(`Cleaned ${plan.length} seeded catalog names and matching order item names.`);
}

try {
  await main();
} catch (error) {
  console.error(`Seed name cleanup failed. ${formatSeedError(error)}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
