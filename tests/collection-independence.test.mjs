import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { User } from "../dist/models/users.model.js";
import { Customer } from "../dist/models/customers.model.js";
import { Order } from "../dist/models/orders.model.js";
import { SystemLock } from "../dist/models/system-locks.model.js";
import { updateProfile } from "../dist/services/profile.service.js";
import { UserService } from "../dist/services/users.service.js";
import { updateCustomer, deleteCustomer } from "../dist/services/customers.service.js";

const id = "a".repeat(24), contactId = "b".repeat(24);
const shared = { email: "shared@example.com", firstName: "Same", lastName: "Name", phone: "0901234567" };
function forbidWrites(t, model) {
  for (const method of ["create", "updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "findOneAndDelete", "findByIdAndDelete", "deleteOne", "deleteMany", "bulkWrite"]) {
    t.mock.method(model, method, () => assert.fail(`Unexpected ${model.modelName}.${method} cross-collection write`));
  }
  t.mock.method(model.prototype, "save", () => assert.fail(`Unexpected ${model.modelName}.save`));
}
function mockTransaction(t) {
  t.mock.method(SystemLock, "updateOne", async () => ({}));
  t.mock.method(mongoose.connection, "transaction", async work => work({}));
}

test("self profile changes only the User ID even when a linked Customer has identical fields", async t => {
  const contact = { ...shared, _id: contactId, accountId: id, isActive: true };
  const before = structuredClone(contact);
  forbidWrites(t, Customer);
  const user = new User({ ...shared, _id: id, password: "stored-hash", role: "staff", active: true, tokenVersion: 0 });
  const changed = { firstName: "New", lastName: "Profile", phone: "0987654321", personalEmail: "", location: "New place", bio: "" };
  t.mock.method(User, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter._id, id);
    assert.equal(Object.hasOwn(filter, "email"), false);
    return new User({ ...user.toObject(), ...update.$set });
  });
  const result = await updateProfile({ id, ...shared, role: "staff", active: true, tokenVersion: 0 }, changed);
  assert.equal(result.firstName, "New");
  assert.deepEqual(contact, before);
});

test("Customer contact editing and deactivation do not update its linked User or sessions", async t => {
  mockTransaction(t); forbidWrites(t, User);
  const account = { ...shared, _id: id, active: true, refreshToken: "session-hash" };
  const before = structuredClone(account);
  t.mock.method(Customer, "findOne", async () => null);
  t.mock.method(Customer, "findByIdAndUpdate", (target, input) => {
    assert.equal(target, contactId);
    return { select: async () => ({ ...shared, _id: contactId, accountId: id, ...input.$set }) };
  });
  const result = await updateCustomer(contactId, { email: "contact-only@example.com", firstName: "Contact only", isActive: false });
  assert.equal(result.email, "contact-only@example.com");
  assert.equal(result.isActive, false);
  assert.deepEqual(account, before);
});

test("administrative User profile editing never changes a same-email Customer", async t => {
  forbidWrites(t, Customer);
  t.mock.method(User, "exists", async filter => {
    assert.deepEqual(filter, { email: "new-login@example.com", role: { $in: ["super_admin", "admin", "staff"] }, _id: { $ne: id } });
    return null;
  });
  t.mock.method(User, "findOneAndUpdate", async (target, update) => {
    assert.equal(target._id, id);
    return { ...shared, _id: id, role: "staff", ...update.$set };
  });
  const result = await UserService.updateUser(id, { email: "new-login@example.com", firstName: "User only" }, { id: 'f'.repeat(24), role: 'super_admin' });
  assert.equal(result.email, "new-login@example.com");
});

test("disabling a User revokes only that User session without deactivating any Customer", async t => {
  mockTransaction(t); forbidWrites(t, Customer);
  t.mock.method(User, "findById", () => ({ session: async () => ({ _id: id, role: "staff" }) }));
  t.mock.method(Order, "exists", () => ({ session: async () => null }));
  t.mock.method(User, "findOneAndUpdate", async (target, update) => {
    assert.equal(target._id, id);
    assert.equal(update.$set.active, false);
    assert.equal(update.$set.refreshToken, null);
    assert.equal(update.$inc.tokenVersion, 1);
    return { _id: id, active: false };
  });
  await UserService.updateUser(id, { active: false }, { id: 'f'.repeat(24), role: 'super_admin' });
});

test("deleting a Customer checks its orders but never deletes its linked User", async t => {
  mockTransaction(t); forbidWrites(t, User);
  t.mock.method(Order, "exists", filter => { assert.deepEqual(filter, { customerId: contactId }); return { session: async () => null }; });
  t.mock.method(Customer, "findByIdAndDelete", async target => { assert.equal(target, contactId); return { _id: contactId, accountId: id }; });
  await deleteCustomer(contactId);
});

test("deleting an administrative User never deletes a same-email Customer", async t => {
  mockTransaction(t); forbidWrites(t, Customer);
  t.mock.method(User, "findById", () => ({ session: async () => ({ _id: id, role: "staff" }) }));
  t.mock.method(Order, "exists", () => ({ session: async () => null }));
  t.mock.method(User, "findOneAndDelete", async target => { assert.equal(target._id, id); return { _id: id }; });
  await UserService.deleteUser(id, { id: 'f'.repeat(24), role: 'super_admin' });
});
