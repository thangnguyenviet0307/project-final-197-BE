import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

// Pure planning helper: no credentials or account documents are printed.
export function planFirstSuperAdmin(users, confirmedId) {
  if (users.some(user => user.role === 'super_admin')) throw new Error('Super Admin already exists; use ownership transfer');
  const candidates = users.filter(user => ['admin', 'staff'].includes(user.role));
  if (candidates.some(user => !user.createdAt || !Number.isFinite(new Date(user.createdAt).getTime()))) throw new Error('Invalid creation timestamps; inspect account history manually');
  const first = [...candidates].sort((a, b) => {
    if (!a.createdAt || !b.createdAt) throw new Error('Missing creation timestamps; inspect account history manually');
    return new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id));
  })[0];
  if (!first || !first.createdAt) throw new Error('No administrative account with a creation timestamp');
  if (!confirmedId || String(first._id) !== confirmedId) throw new Error('Confirm the ID of the earliest administrative account');
  if (first.active === false || first.active === null) throw new Error('First account is disabled; resolve manually');
  return first;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await import('dotenv/config');
    const idIndex = process.argv.indexOf('--user-id');
    const confirmedId = idIndex >= 0 ? process.argv[idIndex + 1] : undefined;
    if (!mongoose.isObjectIdOrHexString(confirmedId)) throw new Error('Provide --user-id with the reviewed account ID');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    const users = mongoose.connection.collection('users');
    const inspect = session => users.find({}, { projection: { _id: 1, role: 1, active: 1, createdAt: 1 }, ...(session ? { session } : {}) }).toArray();
    const first = planFirstSuperAdmin(await inspect(), confirmedId);
    console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'inspect', database: mongoose.connection.name, targetUserId: String(first._id), fromRole: first.role, toRole: 'super_admin' }));
    if (process.argv.includes('--apply')) {
      // Keep application writes paused during apply. Lock matches API relations transactions.
      const locks = mongoose.connection.collection('system_locks');
      await locks.updateOne({ _id: 'relations' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
      await mongoose.connection.transaction(async session => {
        await locks.updateOne({ _id: 'relations' }, { $inc: { revision: 1 } }, { session });
        const target = planFirstSuperAdmin(await inspect(session), confirmedId);
        const result = await users.updateOne({ _id: target._id, role: target.role, active: { $ne: false } },
          { $set: { role: 'super_admin', active: true, refreshToken: null }, $inc: { tokenVersion: 1 } }, { session });
        if (result.modifiedCount !== 1) throw new Error('Account changed; inspect again');
      });
      console.log('Promotion completed; sign in again.');
    }
  } catch {
    // Do not print driver errors, connection URIs or credentials.
    console.error('Promotion stopped. Verify the first account ID, active state, existing owner and database connection.');
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
