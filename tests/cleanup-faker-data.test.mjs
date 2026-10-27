import assert from "node:assert/strict";
import { test } from "node:test";
import { planFakerCleanup, validateCleanup, makeManifest, selectManifest } from "../scripts/cleanup-faker-data.mjs";
const batch = "12345678-1234-1234-1234-123456789abc";
function fixture() {
  return {
    users: [{ _id: "admin", role: "admin", active: true, email: "real@example.com" }, { _id: "staff", role: "staff", email: `seed-user-${batch}-0@example.com` }],
    customers: [{ _id: "seed-c", email: `seed-customer-${batch}-0@example.com` }, { _id: "real-c", email: `seed-customer-${batch}-1@example.com`, accountEnabled: true }],
    products: [{ _id: "seed-p", sku: `SEED-${batch}-PRODUCT-0`, brand: "brand", category: "category" }, { _id: "imported", source: "dummyjson", sku: `SEED-${batch}-PRODUCT-1` }],
    orders: [{ _id: "seed-o", customerId: "seed-c", userId: "staff", orderItems: [{ productId: "seed-p" }] }],
    brands: [{ _id: "brand" }], categories: [{ _id: "category" }], productreviews: [{ _id: "review", product: "seed-p" }],
  };
}
test("exact Faker markers exclude real registered accounts and imported products", () => {
  const plan = planFakerCleanup(fixture());
  assert.deepEqual(plan.customers.map(row => row._id), ["seed-c"]);
  assert.deepEqual(plan.products.map(row => row._id), ["seed-p"]);
  assert.deepEqual(plan.users.map(row => row._id), ["staff"]);
});
test("reviewed manifest refuses stale records and wrong databases", () => {
  const data = fixture(), manifest = makeManifest("project", planFakerCleanup(data));
  assert.equal(selectManifest("project", manifest, data).orders.length, 1);
  assert.throws(() => selectManifest("other", manifest, data));
  data.products[0].price = 1;
  assert.throws(() => selectManifest("project", manifest, data), /changed/);
});
test("retained order references prevent partial deletion", () => {
  const data = fixture(), plan = planFakerCleanup(data);
  plan.orders = [];
  assert.ok(validateCleanup(data, plan).some(reason => reason.includes("Retained order")));
});
test("retained catalog/review references, managed assets and last admin are protected", () => {
  const data = fixture(), plan = planFakerCleanup(data);
  data.products.push({ _id: "real", brand: "brand", category: "category" });
  data.categories.push({ _id: "child", parent: "category" });
  data.productreviews.push({ _id: "real-review", product: "seed-p" });
  plan.products[0].images = [{ public_id: "managed" }];
  plan.users.push(data.users[0]);
  const reasons = validateCleanup(data, plan);
  for (const fragment of ["Retained product", "Retained category", "Retained review", "managed image", "active administrative"]) assert.ok(reasons.some(reason => reason.includes(fragment)));
});
