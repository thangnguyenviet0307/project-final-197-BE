import "dotenv/config";
import mongoose from "mongoose";
import slugify from "slugify";
import { pathToFileURL } from "node:url";

export function planPostMigration(source, posts, categories) {
  const blockers = [], entries = [], additions = [];
  const ids = new Set(posts.map(post => String(post._id)));
  const slugs = new Map(posts.map(post => [post.slug, String(post._id)]));
  const names = new Map(categories.map(category => [category.name, category]));
  const categorySlugs = new Set(categories.map(category => category.slug));
  for (const article of source) {
    if (ids.has(String(article._id))) continue; // Never overwrite an existing post, including edited migrations.
    if (!article.slug || slugs.has(article.slug)) { blockers.push({ id: String(article._id), reason: "Missing/duplicate post slug" }); continue; }
    const name = article.category?.trim();
    if (!name) { blockers.push({ id: String(article._id), reason: "Missing legacy category" }); continue; }
    let category = names.get(name);
    if (!category) {
      const slug = slugify(name, { lower: true, strict: true, locale: "vi" });
      if (!slug || categorySlugs.has(slug)) { blockers.push({ id: String(article._id), reason: "Ambiguous category slug; review manually" }); continue; }
      category = { _id: new mongoose.Types.ObjectId(), name, slug, description: "", isActive: true, __v: 0, createdAt: new Date(), updatedAt: new Date() };
      names.set(name, category); categorySlugs.add(slug); additions.push(category);
    }
    const post = { ...article, categoryId: category._id, category: category.name, sortOrder: article.sortOrder ?? 0, __v: article.__v ?? 0 };
    entries.push({ original: article, post });
    ids.add(String(post._id)); slugs.set(post.slug, String(post._id));
  }
  return { entries, categories: additions, blockers };
}

export async function applyPostMigration(connection, plan) {
  if (plan.blockers.length) throw new Error("Resolve migration blockers before applying");
  await connection.collection("posts").createIndex({ slug: 1 }, { unique: true });
  await connection.collection("categories_post").createIndex({ slug: 1 }, { unique: true });
  await connection.collection("system_locks").updateOne({ _id: "relations" }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  await connection.transaction(async session => {
    await connection.collection("system_locks").updateOne({ _id: "relations" }, { $inc: { revision: 1 } }, { session });
    for (const category of plan.categories) {
      if (await connection.collection("categories_post").findOne({ $or: [{ _id: category._id }, { slug: category.slug }] }, { session })) throw new Error("Category changed since inspection");
      await connection.collection("categories_post").insertOne(category, { session });
    }
    for (const { original, post } of plan.entries) {
      const current = await connection.collection("articles").findOne({ _id: original._id }, { session });
      if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error("Source changed since inspection");
      const category = await connection.collection("categories_post").findOne({ _id: post.categoryId, name: post.category }, { session });
      if (!category) throw new Error("Category changed since inspection");
      if (await connection.collection("posts").findOne({ $or: [{ _id: post._id }, { slug: post.slug }] }, { session })) throw new Error("Post changed since inspection");
      await connection.collection("posts").insertOne(post, { session });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    const connection = mongoose.connection;
    const plan = planPostMigration(await connection.collection("articles").find({}).toArray(), await connection.collection("posts").find({}).toArray(), await connection.collection("categories_post").find({}).toArray());
    console.log(JSON.stringify({ database: connection.name, mode: process.argv.includes("--apply") ? "apply" : "dry-run", postsToCopy: plan.entries.length, categoriesToCreate: plan.categories.length, blockers: plan.blockers }, null, 2));
    if (process.argv.includes("--apply")) {
      if (!process.argv.includes(`--confirm-database=${connection.name}`)) throw new Error("Confirm the exact database with --confirm-database=<name>");
      await applyPostMigration(connection, plan);
    }
  } catch (error) { console.error(error instanceof Error ? error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[redacted]") : "Migration failed"); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
