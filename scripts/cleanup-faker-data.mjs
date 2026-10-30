import "dotenv/config";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const names = ["brands", "categories", "orders", "customers", "products", "users", "productreviews"];
const batch = "(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{8})";
const seedEmail = kind => new RegExp(`^seed-${kind}-${batch}-\\d+@example\\.com$`, "i");
const seedSku = new RegExp(`^SEED-${batch}-(?:PRODUCT-)?\\d+(?:-\\d+)?$`, "i");
const seedSlug = kind => new RegExp(`^seed-${kind}-${batch}-\\d+$`, "i");
const markedCatalog = row => new RegExp(`^${batch}$`, "i").test(row.seedBatch ?? "");
const id = value => String(value?._id ?? value);
const fingerprint = value => createHash("sha256").update(mongoose.mongo.BSON.EJSON.stringify(value)).digest("hex");

// Detection produces review candidates, not proof that every related record was generated.
export function planFakerCleanup(data) {
  const plan = Object.fromEntries(names.map(name => [name, []]));
  plan.users = data.users.filter(row => seedEmail("user").test(row.email ?? "") && ["admin", "staff"].includes(row.role));
  plan.customers = data.customers.filter(row => seedEmail("customer").test(row.email ?? "") && !row.accountEnabled && !row.accountId && !row.password);
  plan.products = data.products.filter(row => !row.source && (seedSku.test(row.sku ?? "") || seedSlug("product").test(row.slug ?? "") || row.variants?.some(variant => seedSku.test(variant.sku ?? ""))));
  const productIds = new Set(plan.products.map(id)), customerIds = new Set(plan.customers.map(id)), userIds = new Set(plan.users.map(id));
  plan.orders = data.orders.filter(row => customerIds.has(id(row.customerId)) && row.orderItems?.length &&
    row.orderItems.every(item => productIds.has(id(item.productId))) && (!row.userId || userIds.has(id(row.userId))));
  for (const [collection, field, kind] of [["brands", "brand", "brand"], ["categories", "category", "category"]]) {
    plan[collection] = data[collection].filter(row => {
      const related = data.products.filter(product => id(product[field]) === id(row));
      return markedCatalog(row) || seedSlug(kind).test(row.slug ?? "") || (related.length > 0 && related.every(product => productIds.has(id(product))));
    });
  }
  plan.productreviews = data.productreviews.filter(row => productIds.has(id(row.product)));
  return plan;
}

export function validateCleanup(data, selected) {
  const sets = Object.fromEntries(names.map(name => [name, new Set(selected[name].map(id))]));
  const blockers = [];
  for (const order of data.orders.filter(row => !sets.orders.has(id(row)))) {
    if (sets.customers.has(id(order.customerId)) || sets.users.has(id(order.userId)) || order.orderItems?.some(item => sets.products.has(id(item.productId)))) blockers.push(`Retained order ${id(order)} references selected data`);
  }
  for (const product of data.products.filter(row => !sets.products.has(id(row)))) {
    if (sets.brands.has(id(product.brand)) || sets.categories.has(id(product.category))) blockers.push(`Retained product ${id(product)} references selected catalog`);
  }
  for (const category of data.categories.filter(row => !sets.categories.has(id(row)))) {
    if (sets.categories.has(id(category.parent))) blockers.push(`Retained category ${id(category)} references selected parent`);
  }
  for (const review of data.productreviews.filter(row => !sets.productreviews.has(id(row)))) {
    if (sets.products.has(id(review.product))) blockers.push(`Retained review ${id(review)} references selected product`);
  }
  for (const product of selected.products) {
    if (product.images?.some(image => image.public_id)) blockers.push(`Product ${id(product)} has managed image assets; remove through the supported image workflow first`);
  }
  const activeAdmins = data.users.filter(row => ["super_admin", "admin"].includes(row.role) && row.active !== false && !sets.users.has(id(row)));
  if (!activeAdmins.length) blockers.push("At least one active administrative account must remain");
  return blockers;
}

export function makeManifest(database, plan) {
  return { database, warning: "Review every ID. Catalog and order/review candidates are inferred from relations and may include manually created data.",
    collections: Object.fromEntries(names.map(name => [name, plan[name].map(row => ({ id: id(row), fingerprint: fingerprint(row) }))])) };
}

export function selectManifest(database, manifest, data) {
  if (manifest.database !== database) throw new Error("Manifest database mismatch");
  const candidates = planFakerCleanup(data), selected = {};
  for (const name of names) {
    const requested = manifest.collections?.[name];
    if (!Array.isArray(requested)) throw new Error(`Missing manifest collection ${name}`);
    selected[name] = requested.map(entry => {
      const row = candidates[name].find(row => id(row) === entry.id);
      if (!row || fingerprint(row) !== entry.fingerprint) throw new Error(`Unrecognized or changed ${name} record; inspect again`);
      return row;
    });
    if (new Set(selected[name].map(id)).size !== selected[name].length) throw new Error("Duplicate manifest IDs");
  }
  const blockers = validateCleanup(data, selected);
  if (blockers.length) throw new Error(blockers.join("; "));
  return selected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = name => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection;
    const load = session => Promise.all(names.map(async name => [name, await db.collection(name).find({}, { ...(session ? { session } : {}) }).sort({ _id: 1 }).toArray()])).then(Object.fromEntries);
    const data = await load(), candidates = planFakerCleanup(data);
    console.log(JSON.stringify({ database: db.name, mode: process.argv.includes("--apply") ? "apply" : "inspect",
      candidates: Object.fromEntries(names.map(name => [name, candidates[name].length])), blockers: validateCleanup(data, candidates),
      note: "No reliable original marker exists for every brand/category/order. Review the manifest; nothing is selected by display name alone." }, null, 2));
    if (argument("--write-manifest")) {
      writeFileSync(argument("--write-manifest"), JSON.stringify(makeManifest(db.name, candidates), null, 2), { flag: "wx", mode: 0o600 });
    }
    if (process.argv.includes("--apply")) {
      if (argument("--confirm-database") !== db.name || !argument("--manifest")) throw new Error("Apply requires --confirm-database and a reviewed --manifest");
      const manifest = JSON.parse(readFileSync(argument("--manifest"), "utf8"));
      // Use the same relationship lock as normal order/catalog mutations.
      await db.collection("system_locks").updateOne({ _id: "relations" }, { $setOnInsert: { revision: 0 } }, { upsert: true });
      await db.transaction(async session => {
        await db.collection("system_locks").updateOne({ _id: "relations" }, { $inc: { revision: 1 } }, { session });
        const fresh = await load(session), selected = selectManifest(db.name, manifest, fresh);
        for (const name of ["productreviews", "orders", "products", "customers", "users", "categories", "brands"]) {
          if (selected[name].length) {
            const result = await db.collection(name).deleteMany({ _id: { $in: selected[name].map(row => row._id) } }, { session });
            if (result.deletedCount !== selected[name].length) throw new Error(`Concurrent change in ${name}; transaction aborted`);
          }
        }
        console.log(JSON.stringify({ deleted: Object.fromEntries(names.map(name => [name, selected[name].length])) }));
      });
      console.log("Cleanup committed. External image storage was not modified.");
    }
  } catch (error) {
    console.error("Faker cleanup stopped:", error instanceof Error && !/mongodb|password|credential/i.test(error.message) ? error.message : "Check database connectivity and the reviewed manifest.");
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
