import createHttpError from "http-errors";
import { escapeRegex } from "../utils/search.js";
import { Customer } from '../models/customers.model.js';
import { Order } from '../models/orders.model.js';
import { withRelationsTransaction } from '../utils/relations-transaction.js';
import type { ICustomer } from '../types/customers.type.js';
import { buildPagination } from '../utils/pagination.js';
import type {
  CreateCustomerInput,
  GetCustomersQuery,
  UpdateCustomerInput,
} from '../types/customers.type.js';

import { User } from '../models/users.model.js';

export async function getCustomerAccounts({ page, limit, search, isActive }: GetCustomersQuery) {
  const filter: Record<string, unknown> = { role: "customer" };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter["$or"] = ["firstName", "lastName", "email"].map(field => ({ [field]: pattern }));
  }
  if (isActive !== undefined) filter["active"] = isActive;
  const [accounts, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .select("_id firstName lastName email active createdAt").lean(),
    User.countDocuments(filter),
  ]);
  // Explicit response fields keep authentication secrets outside this management endpoint.
  const data = accounts.map(account => ({ _id: account._id, firstName: account.firstName,
    lastName: account.lastName, email: account.email, active: account.active, createdAt: account.createdAt }));
  return { data, pagination: buildPagination(page, limit, total) };
}

export async function getCustomers({ page, limit, search, isActive }: GetCustomersQuery) {
  const filter: Record<string, unknown> = {};
  if (search) {
    filter['$or'] = [
      { firstName: new RegExp(escapeRegex(search), 'i') },
      { lastName: new RegExp(escapeRegex(search), 'i') },
      { email: new RegExp(escapeRegex(search), 'i') },
      { phone: new RegExp(escapeRegex(search), 'i') },
    ];
  }
  if (isActive !== undefined) filter['isActive'] = isActive;

  const [data, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-__v'),
    Customer.countDocuments(filter),
  ]);

  return { data, pagination: buildPagination(page, limit, total) };
}

export async function getCustomerById(id: string) {
  const customer = await Customer.findById(id).select('-__v');
  if (!customer) throw createHttpError(404, 'Customer not found');
  return customer;
}

export async function createCustomer(input: CreateCustomerInput): Promise<ICustomer> {
  const existing = await Customer.findOne({ email: input.email });
  if (existing) throw createHttpError(409, 'Email already exists');

  return Customer.create(input);
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<ICustomer | null> {
  return withRelationsTransaction(async (session) => {
    if (input.email) {
      const existing = await Customer.findOne({ email: input.email, _id: { $ne: id } });
      if (existing) throw createHttpError(409, 'Email already exists');
    }

    const customer = await Customer.findByIdAndUpdate(id, input, { returnDocument: 'after', runValidators: true, session }).select('-__v');
    return customer;
  });
}

export async function deleteCustomer(id: string) {
  return withRelationsTransaction(async (session) => {
    if (await Order.exists({ customerId: id }).session(session)) throw createHttpError(409, 'Cannot delete a customer referenced by orders');
    const customer = await Customer.findByIdAndDelete(id, { session });
    if (!customer) throw createHttpError(404, 'Customer not found');
    return customer;
  });
}
