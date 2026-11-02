import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import mongoose from "mongoose";
import { SystemLock } from "../dist/models/system-locks.model.js";
import { PostCategory } from "../dist/models/post-categories.model.js";
beforeEach(t => {
  t.mock.method(PostCategory, "find", () => ({ select() { return this; }, lean: async () => [] }));
  t.mock.method(mongoose.connection, "transaction", work => work({}));
  t.mock.method(SystemLock, "updateOne", async () => ({}));
});
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import app from "../dist/app.js";
import { Article } from "../dist/models/articles.model.js";
import { User } from "../dist/models/users.model.js";
import { generateAccessToken } from "../dist/utils/token.js";
import {
  adminArticleQuerySchema,
  articleVersionSchema,
  createArticleSchema,
  publicArticleQuerySchema,
  updateArticleSchema,
} from "../dist/validations/articles.validation.js";
import * as service from "../dist/services/articles.service.js";

const id = "a".repeat(24);
process.env.JWT_SECRET = randomBytes(32).toString("hex");

const articleInput = {
  title: "Cách chọn cáp sạc",
  category: "Cẩm nang chọn mua",
  excerpt: "Một số điều cần biết trước khi mua cáp.",
  content: "Nội dung bài viết.",
  authorName: "Ban biên tập",
};

test('opt-in summary omits long content while default list/detail retain it', async t => {
  const source = { title: 'Fixture', slug: 'fixture', content: 'x'.repeat(100000), excerpt: 'Summary', publishedAt: null };
  let selected;
  const chain = {
    select(value) { selected = value.split(' '); return this; },
    sort() { return this; }, skip() { return this; }, limit() { return this; },
    async lean() { return [Object.fromEntries(Object.entries(source).filter(([key]) => selected.includes(key)))]; },
  };
  t.mock.method(Article, 'find', () => chain);
  t.mock.method(Article, 'countDocuments', async () => 1);
  const full = await service.listPublicArticles(publicArticleQuerySchema.parse({}));
  const summary = await service.listPublicArticles(publicArticleQuerySchema.parse({ summary: 'true' }));
  assert.equal(full.data[0].content.length, 100000);
  assert.equal('content' in summary.data[0], false);
  assert.equal(summary.data[0].excerpt, source.excerpt);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < Buffer.byteLength(JSON.stringify(full)) / 100);
  t.mock.method(Article, 'findOne', () => ({ select(value) { assert.ok(value.split(' ').includes('content')); return this; }, lean: async () => source }));
  assert.equal((await service.getPublicArticle('fixture')).content, source.content);
});

test("article schemas apply defaults, enforce publish scheduling and reject unknown fields", () => {
  const parsed = createArticleSchema.parse(articleInput);
  assert.equal(parsed.type, "news");
  assert.equal(parsed.slug, undefined);
  assert.deepEqual(parsed.tags, []);
  assert.equal(parsed.status, "draft");
  assert.equal(parsed.publishAt, null);
  assert.equal(parsed.isFeatured, false);
  assert.deepEqual(parsed.seo, {});
  assert.equal(createArticleSchema.parse({ ...articleInput, slug: "Cap-Sac" }).slug, "cap-sac");

  const scheduled = createArticleSchema.safeParse({
    ...articleInput,
    status: "scheduled",
    publishAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(scheduled.success, true);
  assert.equal(scheduled.data.publishAt instanceof Date, true);

  for (const invalid of [
    { ...articleInput, status: "scheduled" },
    { ...articleInput, status: "scheduled", publishAt: new Date(Date.now() - 60_000).toISOString() },
    { ...articleInput, status: "published", publishAt: new Date(Date.now() + 60_000).toISOString() },
    { ...articleInput, slug: "Bad Slug" },
    { ...articleInput, imageUrl: "javascript:alert(1)" },
    { ...articleInput, source: "admin" },
  ]) assert.equal(createArticleSchema.safeParse(invalid).success, false);

  assert.deepEqual(updateArticleSchema.parse({ expectedVersion: 2, title: "Tiêu đề mới" }), {
    expectedVersion: 2,
    title: "Tiêu đề mới",
  });
  for (const invalid of [
    { expectedVersion: 2 },
    { title: "Thiếu phiên bản" },
    { expectedVersion: -1, title: "Không hợp lệ" },
    { expectedVersion: 0, publishedAt: new Date().toISOString() },
    { expectedVersion: 0, price: 99 },
  ]) assert.equal(updateArticleSchema.safeParse(invalid).success, false);

  assert.equal(articleVersionSchema.safeParse({ expectedVersion: 1, anything: true }).success, false);
  assert.equal(publicArticleQuerySchema.safeParse({ page: "1", status: "draft" }).success, false);
  assert.equal(adminArticleQuerySchema.safeParse({ status: "draft", sort: "popular" }).success, true);
});

test("public article listing combines visibility and search filters and returns public-ready pagination", async t => {
  const publishedAt = new Date("2026-10-28T10:00:00.000Z");
  let observedFilter;
  t.mock.method(Article, "find", filter => {
    observedFilter = filter;
    return {
      select(fields) { assert.match(fields, /title/); assert.doesNotMatch(fields, /createdBy|updatedBy|__v/); assert.ok(fields.split(' ').includes('content')); return this; },
      sort(value) { assert.deepEqual(value, { viewCount: -1, publishedAt: -1, _id: -1 }); return this; },
      skip(value) { assert.equal(value, 10); return this; },
      limit(value) { assert.equal(value, 5); return this; },
      lean: async () => [{
        _id: id,
        type: "news",
        title: articleInput.title,
        slug: "cach-chon-cap-sac",
        category: articleInput.category,
        excerpt: articleInput.excerpt,
        imageUrl: null,
        tags: [],
        authorName: articleInput.authorName,
        publishedAt,
        publishAt: null,
        isFeatured: true,
        viewCount: 12,
      }],
    };
  });
  t.mock.method(Article, "countDocuments", async filter => {
    assert.deepEqual(filter, observedFilter);
    return 17;
  });

  const result = await service.listPublicArticles(publicArticleQuerySchema.parse({
    page: "3",
    limit: "5",
    search: "cáp (sạc)",
    type: "news",
    isFeatured: "true",
    sort: "popular",
  }));
  assert.equal(observedFilter.$and.length, 4);
  assert.ok(observedFilter.$and.some(condition => condition.$or?.some(item => item.status === "published")));
  const search = observedFilter.$and.find(condition => condition.$or?.some(item => item.title));
  assert.equal(search.$or[0].title.source, "cáp \\(sạc\\)");
  assert.deepEqual(result.pagination, { page: 3, limit: 5, total: 17, totalPages: 4 });
  assert.equal(result.data[0].publishedAt, publishedAt);
  assert.equal("publishAt" in result.data[0], false);
  assert.equal(result.data[0].viewCount, 12);
});

test("article updates enforce versioning and schedule semantics", async t => {
  const article = new Article({
    ...articleInput,
    slug: "cach-chon-cap-sac",
    status: "draft",
    createdBy: id,
    updatedBy: id,
    __v: 3,
  });
  t.mock.method(Article, "findById", () => ({ session: async () => article }));
  t.mock.method(article, "save", async function () {
    this.__v++;
    return this;
  });
  const future = new Date(Date.now() + 60_000);
  const updated = await service.updateArticle(id, {
    expectedVersion: 3,
    status: "scheduled",
    publishAt: future,
  }, { id, firstName: "Admin", lastName: "User", email: "admin@example.com", role: "admin", active: true });

  assert.equal(updated.status, "scheduled");
  assert.equal(updated.publishedAt.getTime(), future.getTime());
  await assert.rejects(service.updateArticle(id, {
    expectedVersion: 3,
    title: "Stale edit",
  }, { id, firstName: "Admin", lastName: "User", email: "admin@example.com", role: "admin", active: true }), { status: 409 });
  await assert.rejects(service.updateArticle(id, {
    expectedVersion: 4,
    publishAt: new Date(Date.now() - 60_000),
  }, { id, firstName: "Admin", lastName: "User", email: "admin@example.com", role: "admin", active: true }), { status: 400 });
});

test("publishing a draft initializes its publication timestamp", async t => {
  const article = new Article({
    ...articleInput,
    slug: "cach-chon-cap-sac",
    status: "draft",
    createdBy: id,
    updatedBy: id,
    __v: 0,
  });
  t.mock.method(Article, "findById", () => ({ session: async () => article }));
  t.mock.method(article, "save", async function () {
    this.__v++;
    return this;
  });

  const published = await service.updateArticle(id, {
    expectedVersion: 0,
    status: "published",
  }, { id, firstName: "Admin", lastName: "User", email: "admin@example.com", role: "admin", active: true });
  assert.equal(published.status, "published");
  assert.ok(published.publishedAt instanceof Date);
});

test("public articles are anonymous while every management endpoint is admin-only", async t => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/articles`;
  let role = "staff";
  t.mock.method(User, "findById", () => ({
    select: async () => new User({
      _id: id,
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      role,
      active: true,
      tokenVersion: 0,
    }),
  }));
  let observedQuery;
  t.mock.method(Article, "find", filter => { observedQuery = filter; return ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [],
  }); });
  t.mock.method(Article, "countDocuments", async () => 0);

  const token = generateAccessToken({ id });
  const customerToken = generateAccessToken({ id, accountType: "customer" });
  const request = (path, authorization, method = "GET", body) => fetch(base + path, {
    method,
    headers: {
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  assert.equal((await request("/public?page=1")).status, 200);
  for (const featured of ["true", "false"]) {
    assert.equal((await request(`/public?type=news&isFeatured=${featured}&sort=display`)).status, 200);
    assert.ok(observedQuery.$and.some(condition => condition.isFeatured === (featured === "true")));
  }
  for (const query of ["isFeatured=invalid", "isFeatured=1", "isFeatured=true&isFeatured=false"]) {
    assert.equal((await request(`/public?${query}`)).status, 400);
  }
  assert.equal((await request("/")).status, 401);
  assert.equal((await request("/", token)).status, 403);
  assert.equal((await request("/category-options", token, "POST", { name: "Test", slug: "test" })).status, 403);
  assert.equal((await request(`/category-options/${id}`, token, "DELETE", { expectedVersion: 0 })).status, 403);
  assert.equal((await request("/", customerToken)).status, 403);

  role = "admin";
  for (const featured of ["true", "false"]) {
    assert.equal((await request(`/?isFeatured=${featured}`, token)).status, 200);
    assert.ok(observedQuery.$and.some(condition => condition.isFeatured === (featured === "true")));
  }
  assert.equal((await request("/", token)).status, 200);
  assert.equal((await request("/", token, "POST", { ...articleInput, source: "admin" })).status, 400);
  assert.equal((await request(`/${id}`, token, "PATCH", { title: "No version" })).status, 400);
  assert.equal((await request("/stats", token, "DELETE", {})).status, 400);
});

test("posts use managed categories, retain slugs on title edits and hide inactive categories", async t => {
  assert.equal(Article.collection.collectionName, "posts");
  assert.equal(PostCategory.collection.collectionName, "categories_post");
  const categoryId = "b".repeat(24);
  const category = new PostCategory({ _id: categoryId, name: "Managed", slug: "managed", isActive: true });
  t.mock.method(PostCategory, "findOne", () => ({ session: async () => category }));
  t.mock.method(Article, "exists", async () => null);
  t.mock.method(Article.prototype, "save", async function () { return this; });
  const created = await service.createArticle(createArticleSchema.parse({ ...articleInput, categoryId, category: "Untrusted label" }), { id, role: "admin" });
  assert.equal(created.category, "Managed");
  assert.equal(String(created.categoryId), categoryId);
  created.__v = 0;
  t.mock.method(Article, "findById", () => ({ session: async () => created }));
  t.mock.method(PostCategory, "findById", () => ({ session: async () => category }));
  const slug = created.slug;
  await service.updateArticle(String(created._id), { expectedVersion: 0, title: "A totally new title" }, { id, role: "admin" });
  assert.equal(created.slug, slug);
  category.isActive = false;
  await assert.rejects(service.updateArticle(String(created._id), { expectedVersion: 0, status: "published" }, { id, role: "admin" }), { status: 400 });
});

test("category deletion protects posts and versioned article deletion rejects stale edits", async t => {
  const categories = await import("../dist/services/post-categories.service.js");
  t.mock.method(Article, "exists", () => ({ session: async () => ({ _id: id }) }));
  await assert.rejects(categories.deletePostCategory(id, 0), { status: 409 });
  t.mock.method(Article, "findById", () => ({ select() { return this; }, session: async () => ({ __v: 2 }) }));
  const remove = t.mock.method(Article, "deleteOne", async () => assert.fail("Stale deletion must not write"));
  await assert.rejects(service.deleteArticle(id, 1), { status: 409, businessCode: "VERSION_CONFLICT" });
  assert.equal(remove.mock.callCount(), 0);
});

test("homepage article filtering uses explicit selection and display order before pagination", async t => {
  let filter;
  t.mock.method(Article, "find", value => { filter = value; return {
    select() { return this; }, sort(value) { assert.deepEqual(value, { sortOrder: 1, publishedAt: -1, _id: -1 }); return this; },
    skip() { return this; }, limit(value) { assert.equal(value, 3); return this; }, lean: async () => [],
  }; });
  t.mock.method(Article, "countDocuments", async () => 0);
  await service.listPublicArticles(publicArticleQuerySchema.parse({ isFeatured: "true", type: "news", sort: "display", limit: 3 }));
  assert.ok(filter.$and.some(value => value.isFeatured === true));
  const visibility = filter.$and.find(value => value.$and);
  assert.deepEqual(visibility.$and[0].$or[1], { categoryId: { $in: [] } });
});

test("category rename increments referenced post versions and rejects stale category updates", async t => {
  const categories = await import("../dist/services/post-categories.service.js");
  const category = new PostCategory({ _id: id, name: "Before", slug: "before", __v: 2 });
  t.mock.method(PostCategory, "findById", () => ({ session: async () => category }));
  t.mock.method(category, "save", async function () { this.__v++; return this; });
  const changed = t.mock.method(Article, "updateMany", async (scope, update) => {
    assert.equal(scope.categoryId, id);
    assert.deepEqual(update, { $set: { category: "After" }, $inc: { __v: 1 } });
  });
  await categories.updatePostCategory(id, { expectedVersion: 2, name: "After" });
  assert.equal(changed.mock.callCount(), 1);
  await assert.rejects(categories.updatePostCategory(id, { expectedVersion: 2, name: "Stale" }), { status: 409, businessCode: "VERSION_CONFLICT" });
  assert.equal(category.name, "After");
});
