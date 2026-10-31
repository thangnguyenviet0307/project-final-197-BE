import assert from "node:assert/strict";
import test from "node:test";
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
      select(fields) { assert.match(fields, /title/); assert.doesNotMatch(fields, /createdBy|updatedBy|__v/); return this; },
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
  t.mock.method(Article, "findById", async () => article);
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
  t.mock.method(Article, "findById", async () => article);
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
  t.mock.method(Article, "find", () => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [],
  }));
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
  assert.equal((await request("/")).status, 401);
  assert.equal((await request("/", token)).status, 403);
  assert.equal((await request("/", customerToken)).status, 403);

  role = "admin";
  assert.equal((await request("/", token)).status, 200);
  assert.equal((await request("/", token, "POST", { ...articleInput, source: "admin" })).status, 400);
  assert.equal((await request(`/${id}`, token, "PATCH", { title: "No version" })).status, 400);
  assert.equal((await request("/stats", token, "DELETE", {})).status, 400);
});
