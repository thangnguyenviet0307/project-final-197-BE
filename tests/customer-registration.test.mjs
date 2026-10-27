import assert from "node:assert/strict";
import { test } from "node:test";
import { Customer } from "../dist/models/customers.model.js";
import { User } from "../dist/models/users.model.js";
import { registerCustomer, loginCustomer, changeCustomerPassword } from "../dist/services/customer-auth.service.js";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_REFRESH_SECRET = randomBytes(32).toString("hex");
const input = { email: "same@example.com", firstName: "First", lastName: "Last", password: "Customer123!" };
test("a customer email is independent of all administrative emails", async t => {
  t.mock.method(User, "exists", () => assert.fail("No administrative lookup"));
  t.mock.method(User, "create", () => assert.fail("No administrative writes"));
  t.mock.method(Customer, "exists", async filter => { assert.deepEqual(filter, { email: input.email }); return null; });
  t.mock.method(Customer, "create", async data => new Customer(data));
  const result = await registerCustomer(input);
  assert.equal(result.email, input.email); assert.equal(result.role, undefined);
});
test("manual legacy contacts cannot log in or be claimed by email registration", async t => {
  t.mock.method(Customer, "exists", async () => ({ _id: "legacy" }));
  await assert.rejects(registerCustomer(input), { status: 409 });
  t.mock.method(Customer, "findOne", () => ({ select: async () => null }));
  await assert.rejects(loginCustomer(input.email, input.password), { status: 401 });
});
test("customer password change checks old password and revokes only customer sessions", async t => {
  t.mock.method(User, "findOneAndUpdate", () => assert.fail("No User writes"));
  const customer = new Customer({ ...input, password: await argon2.hash(input.password), accountEnabled: true, isActive: true, tokenVersion: 2 });
  t.mock.method(Customer, "findById", () => ({ select: async () => customer }));
  let called = 0;
  t.mock.method(Customer, "findOneAndUpdate", async (filter, update) => {
    called++; assert.equal(filter._id, String(customer._id)); assert.equal(filter.tokenVersion, 2);
    assert.equal(update.$inc.tokenVersion, 1); assert.equal(update.$set.refreshToken, null);
    assert.equal(await argon2.verify(update.$set.password, "NewPassword123!"), true); return customer;
  });
  await assert.rejects(changeCustomerPassword(String(customer._id), { currentPassword: "wrong", newPassword: "NewPassword123!" }), { status: 400 });
  assert.equal(called, 0);
  await changeCustomerPassword(String(customer._id), { currentPassword: input.password, newPassword: "NewPassword123!" });
  assert.equal(called, 1);
});
