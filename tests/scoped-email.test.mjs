import assert from "node:assert/strict";
import { test } from "node:test";
import { planCustomerMigration, applyCustomerMigration } from "../scripts/migrate-customer-accounts.mjs";
const user = { _id: "legacy-user", role: "customer", email: "buyer@example.com", password: "existing-hash", tokenVersion: 3, active: true };
const customer = { _id: "existing-customer-id", accountId: user._id, email: user.email, firstName: "Contact name", phone: "123", isActive: true };
test("migration preserves Customer ID, profile and order references while revoking old customer sessions", async () => {
  const plan = planCustomerMigration([user, { _id: "admin", role: "admin", email: user.email }], [customer]);
  assert.deepEqual(plan.blockers, []); assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].customer._id, customer._id);
  assert.equal(plan.entries[0].fields.password, user.password);
  assert.equal(plan.entries[0].fields.tokenVersion, 4);
  assert.equal(plan.entries[0].fields.refreshToken, null);
  assert.equal(plan.entries[0].fields.firstName, undefined);
  const order = { customerId: customer._id, totalAmount: 100, customerSnapshot: { firstName: "Historical" } };
  const original = structuredClone(order);
  const operations = [];
  const collections = {
    legacy_customer_accounts_archive: { findOne: async () => null, insertOne: async value => { operations.push(["archive", value._id]); } },
    customers: { updateOne: async (filter, changes) => { assert.equal(filter._id, order.customerId); assert.equal(changes.$unset.accountId, ""); operations.push(["customer", filter._id]); return { modifiedCount: 1 }; } },
    users: { deleteOne: async filter => { assert.equal(filter.role, "customer"); operations.push(["legacyUser", filter._id]); return { deletedCount: 1 }; } },
  };
  await applyCustomerMigration({ collection: name => { assert.notEqual(name, "orders"); return collections[name]; }, transaction: async work => work({}) }, plan);
  assert.deepEqual(order, original);
  assert.deepEqual(operations.map(item => item[0]), ["archive", "customer", "legacyUser"]);
});
test("migration blocks missing/ambiguous links and conflicting emails instead of matching by email", () => {
  for (const contacts of [ [{ ...customer, accountId: undefined }], [customer, { ...customer, _id: "duplicate" }], [{ ...customer, email: "different@example.com" }], [{ ...customer, accountEnabled: true }]]) {
    assert.ok(planCustomerMigration([user], contacts).blockers.length);
  }
});
test("migration retains unregistered contacts and is idempotent after legacy accounts are removed", () => {
  const plan = planCustomerMigration([], [{ ...customer, accountId: undefined, accountEnabled: true }]);
  assert.deepEqual(plan.entries, []); assert.deepEqual(plan.blockers, []);
  assert.equal(planCustomerMigration([], [{ ...customer, accountId: undefined }]).unregisteredContacts, 1);
});
test("migration refuses stale source writes and never touches order collections", async () => {
  const plan = planCustomerMigration([user], [customer]);
  await assert.rejects(applyCustomerMigration({
    collection: name => {
      assert.notEqual(name, "orders");
      return name === "legacy_customer_accounts_archive" ? { findOne: async () => null, insertOne: async () => {} }
        : name === "customers" ? { updateOne: async () => ({ modifiedCount: 0 }) }
          : { deleteOne: async () => assert.fail("Do not remove source after stale contact write") };
    }, transaction: async work => work({}),
  }, plan), /changed since inspection/);
});

test("unlinked legacy accounts create a new Customer under the same ID without claiming contacts", () => {
  const plan = planCustomerMigration([user], []);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.entries[0].createNew, true);
  assert.equal(plan.entries[0].customer._id, user._id);
});
