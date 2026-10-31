import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ quiet: true });
mongoose.set('autoIndex', false); mongoose.set('autoCreate', false);
const deadline = setTimeout(() => { console.error('Read-only catalog verification timed out.'); process.exit(1); }, 25000);
deadline.unref();
try {
  const { default: Product } = await import('../dist/models/products.model.js');
  const { discountedPricePageIds, buildProductQuery, buildProductSearchQuery } = await import('../dist/utils/product-query.js');
  const { calculateOrderTotal } = await import('../dist/utils/order-total.js');
  const { BrandModel } = await import('../dist/models/brands.model.js');
  const { Categories } = await import('../dist/models/categories.model.js');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const rows = await Product.find({}).select('price discount variants.price').lean();
  const priced = rows.map(row => ({ id: String(row._id), price: calculateOrderTotal([{ price: row.variants?.length ? Math.min(...row.variants.map(variant => variant.price)) : row.price, discount: row.discount ?? 0, quantity: 1 }]) }));
  for (const sortOrder of ['asc', 'desc']) {
    const direction = sortOrder === 'asc' ? 1 : -1;
    const expected = [...priced].sort((a, b) => direction * (a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))).slice(0, 100).map(row => row.id);
    if (expected.length) assert.deepEqual((await discountedPricePageIds({}, { sortOrder }, 1, 100)).map(String), expected);
  }
  const threshold = priced[0]?.price ?? 0;
  assert.equal(await Product.countDocuments(buildProductQuery({ maxPrice: threshold })), priced.filter(row => row.price <= threshold).length);
  let checkedSearchReferences = 0;
  for (const [model, field] of [[BrandModel, 'brand'], [Categories, 'category']]) {
    const reference = await model.findOne({ isDeleted: { $ne: true } }).select('name').lean();
    if (!reference) continue;
    const query = await buildProductSearchQuery({ search: reference.name });
    const direct = await Product.find({ [field]: reference._id }).select('_id').lean();
    const matching = new Set((await Product.find(query).select('_id').lean()).map(row => String(row._id)));
    assert.ok(direct.every(row => matching.has(String(row._id))));
    checkedSearchReferences++;
  }
  console.log(JSON.stringify({ database: mongoose.connection.name, mode: 'read-only', productsChecked: rows.length, discountedSortAsc: 'passed', discountedSortDesc: 'passed', discountedRange: 'passed', checkedSearchReferences }));
} catch (error) {
  console.error(JSON.stringify({ errorType: error.name, code: error.code ?? null, catalogReadCheckFailed: true }));
  process.exitCode = 1;
} finally { clearTimeout(deadline); await mongoose.disconnect(); }
