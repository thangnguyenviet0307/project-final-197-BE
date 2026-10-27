import 'dotenv/config';
import mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Product from '../models/products.model.js';
import { ProductReview } from '../models/product-reviews.model.js';
import { generateProductMetadata, generateProductReview } from './generate.js';
import { updateProductSchema } from '../validations/products.validation.js';
import { formatSeedError } from './errors.js';

const seedBatch = '(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{8})';
// Exact historical generator signatures; a generic "SEED-" prefix is insufficient.
export const fakerProductFilter = {
  source: { $exists: false },
  $or: [
    { 'variants.sku': new RegExp(`^SEED-${seedBatch}-\\d+-\\d+$`, 'i') },
    { sku: new RegExp(`^SEED-${seedBatch}-PRODUCT-\\d+$`, 'i') },
    { slug: new RegExp(`^seed-product-${seedBatch}-\\d+$`, 'i') },
  ],
};

export interface RawSeedProduct extends Record<string, unknown> {
  _id: mongoose.Types.ObjectId;
  __v?: number;
}

/** Raw database input is essential: hydration would hide missing fields behind defaults. */
export function planProductMetadata(product: RawSeedProduct, categorySlug = 'catalog') {
  const metadata = {
    ...generateProductMetadata(`SEED-LEGACY-${String(product._id).toUpperCase()}`, categorySlug),
    minimumOrderQuantity: 1, model_year: null, sourceImages: [],
  };
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(metadata)) {
    const current = product[field];
    const missing = current === undefined || current === null || current === '' || (Array.isArray(current) && current.length === 0);
    // These optional empty/default values are already valid; do not rewrite on every run.
    if (missing && !(Object.hasOwn(product, field) && (field === 'model_year' || field === 'sourceImages'))) patch[field] = value;
  }
  if (Object.keys(patch).length) updateProductSchema.parse(patch);
  return patch;
}

export function backfillProductGuard(product: RawSeedProduct, patch: Record<string, unknown>) {
  return {
    _id: product._id,
    ...fakerProductFilter,
    __v: product.__v ?? { $exists: false },
    $and: Object.keys(patch).map(field => Object.hasOwn(product, field)
      ? { [field]: { $eq: product[field], $exists: true } }
      : { [field]: { $exists: false } }),
  };
}

async function main() {
  if (process.env['NODE_ENV'] === 'production') throw new Error('Faker backfill is disabled in production.');
  const uri = process.env['MONGODB_URI']?.trim();
  if (!uri) throw new Error('MONGODB_URI is not configured.');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const database = mongoose.connection.db;
  if (!database) throw new Error('MongoDB connection is not ready.');
  const collection = database.collection<RawSeedProduct>('products');
  const records = await collection.find(fakerProductFilter).sort({ _id: 1 }).toArray();
  const categories = await database.collection('categories').find({}, { projection: { slug: 1 } }).toArray();
  const categorySlugs = new Map(categories.map(category => [String(category._id), String(category['slug'] ?? 'catalog')]));
  const plans: { product: RawSeedProduct; patch: Record<string, unknown>; reviews: ReturnType<typeof generateProductReview>[] }[] = [];
  for (const product of records) {
    const patch = planProductMetadata(product, categorySlugs.get(String(product['category'])));
    const hasReviews = await ProductReview.collection.countDocuments({ product: product._id });
    // Add demo reviews only when this native Faker product has no reviews at all.
    const reviews = hasReviews ? [] : Array.from({ length: 3 }, () => generateProductReview(product._id, faker.person.fullName()));
    if (!Object.keys(patch).length && !reviews.length) continue;
    // Check both validation layers without changing any pre-existing values.
    await new Product({ ...product, ...patch }).validate();
    for (const review of reviews) await review.validate();
    if (patch['sku'] && await collection.findOne({
      _id: { $ne: product._id }, $or: [{ sku: patch['sku'] }, { 'variants.sku': patch['sku'] }],
    })) throw new Error(`Generated SKU conflicts for product ${String(product._id)}.`);
    plans.push({ product, patch, reviews });
  }
  console.log(JSON.stringify({ environment: process.env['NODE_ENV'] ?? 'unset', database: database.databaseName,
    matchedFakerProducts: records.length, productsToUpdate: plans.length,
    newReviews: plans.reduce((sum, plan) => sum + plan.reviews.length, 0) }));
  const fields: Record<string, number> = {};
  for (const plan of plans) for (const field of Object.keys(plan.patch)) fields[field] = (fields[field] ?? 0) + 1;
  console.table(fields);
  if (!process.argv.includes('--apply')) {
    console.log('Preview only. No writes. Run with --apply to update only the listed Faker records.');
    return;
  }
  if (!plans.length) { console.log('Nothing to update.'); return; }
  if (plans.some(plan => plan.reviews.length)) {
    try { await database.createCollection(ProductReview.collection.name); }
    catch (error) { if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 48) throw error; }
  }
  await mongoose.connection.transaction(async session => {
    for (const { product, patch, reviews } of plans) {
      const guard = backfillProductGuard(product, patch);
      // Empty $and is invalid in MongoDB; version still guards review-only changes.
      const filter = guard.$and.length ? guard : { ...fakerProductFilter, _id: product._id, __v: guard.__v };
      const result = await collection.updateOne(filter,
        { $set: { ...patch, __v: (product.__v ?? 0) + 1 } }, { session });
      if (result.matchedCount !== 1) throw new Error('A Faker product changed since preview; rerun to review the latest data.');
      if (reviews.length && await ProductReview.countDocuments({ product: product._id }).session(session)) {
        throw new Error('Reviews changed since preview; rerun to avoid duplicate demo reviews.');
      }
      for (const review of reviews) await review.save({ session });
    }
  });
  console.log(`Updated ${plans.length} Faker products; added ${plans.reduce((sum, plan) => sum + plan.reviews.length, 0)} demo reviews. Existing prices, stock, orders and timestamps were preserved.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) { console.error(`Faker product backfill failed. ${formatSeedError(error)}`); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
