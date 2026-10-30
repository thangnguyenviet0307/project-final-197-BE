import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

// Pure plan: accountId is the only automatic legacy link. Never claim a contact by email.
export function planCustomerMigration(users, customers) {
  const entries = [], blockers = [];
  const sameId = (a, b) => String(a) === String(b);
  const emails = new Set();
  for (const user of users.filter(user => user.role === "customer")) {
    const matches = customers.filter(customer => customer.accountId && sameId(customer.accountId, user._id));
    const createNew = matches.length === 0 && !customers.some(customer => sameId(customer._id, user._id) || customer.email?.trim().toLowerCase() === user.email?.trim().toLowerCase());
    if (matches.length !== 1 && !createNew) { blockers.push({ userId: String(user._id), reason: "Ambiguous legacy contact requires review" }); continue; }
    const customer = createNew ? { _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      phone: user.phone ?? "", address: { street: "", city: "", state: "" }, isActive: user.active !== false,
      createdAt: user.createdAt, updatedAt: user.updatedAt } : matches[0];
    const email = user.email?.trim().toLowerCase();
    if (!email || email !== customer.email?.trim().toLowerCase() || emails.has(email) ||
      customers.some(other => !sameId(other._id, customer._id) && other.email?.trim().toLowerCase() === email) || !user.password || customer.accountEnabled) {
      blockers.push({ userId: String(user._id), reason: "Email, credential or existing-account conflict requires review" }); continue;
    }
    emails.add(email);
    entries.push({ user, customer, createNew, fields: { password: user.password, accountEnabled: true, mustChangePassword: user.mustChangePassword === true,
      isActive: user.active !== false && customer.isActive !== false,
      tokenVersion: Math.max(user.tokenVersion ?? 0, customer.tokenVersion ?? 0) + 1, refreshToken: null,
      ...Object.fromEntries(["personalEmail", "location", "bio", "avatar"].filter(key => customer[key] === undefined && user[key] !== undefined).map(key => [key, user[key]])),
    } });
  }
  const administrativeEmails = new Set();
  for (const user of users.filter(user => user.role !== "customer")) {
    const email = user.email?.trim().toLowerCase();
    if (!["super_admin", "admin", "staff"].includes(user.role) || !email || administrativeEmails.has(email)) blockers.push({ userId: String(user._id), reason: "Invalid or duplicate administrative account" });
    administrativeEmails.add(email);
  }
  return { entries, blockers, unregisteredContacts: customers.filter(customer => !customer.accountEnabled && !customer.accountId).length };
}

export async function applyCustomerMigration(connection, plan) {
  if (plan.blockers.length) throw new Error("Migration blockers require review");
  const users = connection.collection("users"), customers = connection.collection("customers");
  const archive = connection.collection("legacy_customer_accounts_archive");
  // This dedicated archive preserves the original credentials for controlled rollback.
  // Orders and their snapshots are never written; all destination Customer IDs are preserved.
  for (const entry of plan.entries) {
    await connection.transaction(async session => {
      const archived = await archive.findOne({ _id: entry.user._id }, { session });
      if (!archived) await archive.insertOne({ ...entry.user, archivedAt: new Date(), destinationCustomerId: entry.customer._id, destinationCustomerWasCreated: entry.createNew, destinationCustomerBefore: entry.createNew ? null : entry.customer }, { session });
      if (entry.createNew) {
        await customers.insertOne({ ...entry.customer, ...entry.fields }, { session });
      } else {
        const updated = await customers.updateOne({ _id: entry.customer._id, accountId: entry.user._id, accountEnabled: { $ne: true }, email: entry.customer.email },
          { $set: entry.fields, $unset: { accountId: "" } }, { session });
        if (updated.modifiedCount !== 1) throw new Error("Customer changed since inspection");
      }
      const removed = await users.deleteOne({ _id: entry.user._id, role: "customer", password: entry.user.password, $or: [{ tokenVersion: entry.user.tokenVersion ?? 0 }, { tokenVersion: { $exists: false } }] }, { session });
      if (removed.deletedCount !== 1) throw new Error("Legacy account changed since inspection");
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    const connection = mongoose.connection;
    const users = connection.collection("users"), customers = connection.collection("customers");
    const plan = planCustomerMigration(await users.find({}).toArray(), await customers.find({}).toArray());
    const report = { database: connection.name, mode: process.argv.includes("--apply") ? "apply" : "inspect", accountsToMove: plan.entries.length, existingCustomersToUpgrade: plan.entries.filter(entry => !entry.createNew).length, newCustomersToCreate: plan.entries.filter(entry => entry.createNew).length,
      blockers: plan.blockers, unregisteredContactsRetained: plan.unregisteredContacts,
      ordersBefore: await connection.collection("orders").countDocuments({}),
      customerIndexes: (await customers.indexes()).map(index => ({ name: index.name, key: index.key, unique: !!index.unique })) };
    console.log(JSON.stringify(report, null, 2));
    if (plan.blockers.length) throw new Error("Resolve blockers before applying");
    if (process.argv.includes("--apply")) {
      await applyCustomerMigration(connection, plan);
      await users.createIndex({ email: 1 }, { unique: true, name: "email_1" });
      await customers.createIndex({ email: 1 }, { unique: true, name: "email_1" });
      for (const index of await users.indexes()) {
        if (["users_email_admin_unique", "users_email_customer_unique"].includes(index.name)) await users.dropIndex(index.name);
      }
      for (const index of await customers.indexes()) {
        if (index.unique && index.key.phone === 1 && Object.keys(index.key).length === 1) await customers.dropIndex(index.name);
      }
      await customers.createIndex({ phone: 1 });
      const ordersAfter = await connection.collection("orders").countDocuments({});
      if (ordersAfter !== report.ordersBefore) throw new Error("Order count changed during migration; investigate before reopening traffic");
      console.log(JSON.stringify({ migrated: plan.entries.length, legacyCustomerUsersRemaining: await users.countDocuments({ role: "customer" }), ordersAfter }));
    }
  } catch {
    console.error("Customer migration stopped. Review the report. No credentials are printed. Retry is supported after resolving blockers; keep application writes paused during apply.");
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
