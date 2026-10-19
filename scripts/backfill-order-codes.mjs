import mongoose from 'mongoose';
import { connectDatabase } from '../dist/config/database.js';
import { Order } from '../dist/models/orders.model.js';
import { generateOrderCode, isOrderCodeCollision } from '../dist/utils/order-code.js';

// Dry run by default. Run after a Backend build; --apply explicitly enables writes.
const apply = process.argv.includes('--apply');
try {
  await connectDatabase();
  const missing = { $or: [{ orderCode: { $exists: false } }, { orderCode: null }, { orderCode: '' }] };
  console.log(`Orders without a code: ${await Order.collection.countDocuments(missing)}. Mode: ${apply ? 'apply' : 'dry run'}.`);
  if (apply) {
    await Order.collection.createIndex({ orderCode: 1 }, { unique: true, partialFilterExpression: { orderCode: { $type: 'string' } } });
    let updated = 0;
    for await (const order of Order.collection.find(missing, { projection: { _id: 1 } })) {
      let done = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          // Raw conditional update intentionally bypasses immutability only for missing codes.
          const result = await Order.collection.updateOne({ _id: order._id, ...missing }, { $set: { orderCode: generateOrderCode() } });
          updated += result.modifiedCount;
          done = true;
          break;
        } catch (error) { if (!isOrderCodeCollision(error)) throw error; }
      }
      if (!done) throw new Error('Could not allocate a unique code; rerun to resume.');
    }
    console.log(`Assigned codes to ${updated} orders. Existing codes were preserved.`);
  }
} catch {
  console.error('Order code migration failed. Check database connectivity, indexes and existing codes.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }