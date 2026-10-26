import 'dotenv/config';
import mongoose from 'mongoose';
import { generateSeedData } from './generate.js';
import { formatSeedError } from './errors.js';
import { BrandModel } from '../models/brands.model.js';
import { Categories } from '../models/categories.model.js';
import Product from '../models/products.model.js';
import type { ExistingCatalog } from './names.js';

let stage = 'validating seed data';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (process.env['NODE_ENV'] === 'production') throw new Error('Seeding is disabled in production.');
  const password = process.env['SEED_PASSWORD'];
  if (!dryRun && (!password || password.length < 12)) throw new Error('Set SEED_PASSWORD with at least 12 characters.');
  const existing: ExistingCatalog = {};
  if (!dryRun) {
    const uri = process.env['MONGODB_URI']?.trim();
    if (!uri) throw new Error('MONGODB_URI is not defined. Please add it to your .env file.');
    stage = 'connecting to MongoDB Atlas';
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false });
    stage = 'reading existing catalog names';
    const [brands, categories, products] = await Promise.all([
      BrandModel.find().select('name slug').lean(),
      Categories.find().select('name slug').lean(),
      Product.find().select('product_name slug').lean(),
    ]);
    existing.brands = brands.map(value => ({ name: value.name, slug: value.slug }));
    existing.categories = categories.map(value => ({ name: value.name, slug: value.slug }));
    existing.products = products.map(value => ({ name: value.product_name, slug: value.slug }));
  }
  stage = 'validating seed data';
  const data = await generateSeedData(password ?? 'DryRunOnly-NotStored', existing);
  const counts = Object.fromEntries(Object.entries(data).map(([name, documents]) => [name, documents.length]));
  if (dryRun) {
    console.log('Schema validation passed; no database connection or writes.', counts);
    return;
  }
  stage = 'initializing collections';
  const database = mongoose.connection.db;
  if (!database) throw new Error('MongoDB connection is not ready.');
  // Collections must exist before the transaction; existing indexes remain intact.
  for (const model of Object.values(mongoose.models)) {
    try {
      await database.createCollection(model.collection.name);
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 48) throw error;
    }
  }
  stage = 'saving seed documents in a transaction';
  await mongoose.connection.transaction(async session => {
    for (const documents of Object.values(data)) {
      for (const document of documents) {
        // Keep historical order timestamps instead of marking every order updated today.
        await document.save({ session, timestamps: document.collection.name !== 'orders' });
      }
    }
  });
  console.log('Seed completed (existing data was preserved).', counts);
  console.log('Admin login email:', data.users[0]!.email);
}

try {
  await main();
} catch (error) {
  console.error(`Seed failed while ${stage}. ${formatSeedError(error)}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
