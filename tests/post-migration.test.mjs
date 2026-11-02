import assert from "node:assert/strict";
import test from "node:test";
import { planPostMigration, applyPostMigration } from "../scripts/migrate-articles-to-posts.mjs";
test("article migration preserves IDs/slugs, groups categories and never overwrites migrated posts", () => {
  const source = [{ _id: "1", slug: "first", category: "Accessories" }, { _id: "2", slug: "second", category: "Accessories" }];
  const plan = planPostMigration(source, [], []);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.categories.length, 1);
  assert.equal(plan.entries[0].post._id, "1");
  assert.equal(plan.entries[0].post.slug, "first");
  assert.equal(String(plan.entries[0].post.categoryId), String(plan.entries[1].post.categoryId));
  assert.equal(planPostMigration(source, [{ _id: "1", slug: "edited" }], []).entries.length, 1);
  assert.equal(planPostMigration(source, [{ _id: "another", slug: "first" }], []).blockers.length, 1);
});
test("migration refuses writes when blockers remain", async () => {
  await assert.rejects(applyPostMigration({}, { blockers: ["collision"] }), /blockers/);
});
