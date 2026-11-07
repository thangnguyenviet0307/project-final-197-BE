import { GuestContacts } from '../../models/customers/guest-contacts.model.js';
import {
  addressToShipping,
  shippingToAddress,
} from '../../utils/customers/customer-address.js';
import { resolveCurrentAddressNames } from '../orders/checkout-locations.service.js';
import createHttpError from 'http-errors';
import { escapeRegex } from '../../utils/shared/search.js';
import { Customer } from '../../models/customers/customers.model.js';
import { Order } from '../../models/orders/orders.model.js';
import { withRelationsTransaction } from '../../utils/shared/relations-transaction.js';
import type { ICustomer } from '../../types/customers/customers.type.js';
import { buildPagination } from '../../utils/shared/pagination.js';
import type {
  GetCustomersQuery,
  UpdateCustomerInput,
} from '../../types/customers/customers.type.js';

export async function getCustomers(
  { page, limit, search, isActive }: GetCustomersQuery,
  accountsOnly = false
) {
  const filter: Record<string, unknown> = {};
  if (search)
    filter['$or'] = [
      'firstName',
      'lastName',
      'displayName',
      'email',
      'phone',
    ].map((field) => ({ [field]: new RegExp(escapeRegex(search), 'i') }));
  if (isActive !== undefined) filter['isActive'] = isActive;
  if (accountsOnly) filter['customerType'] = 'registered';
  const [result] = await Customer.aggregate([
    { $match: { accountEnabled: true } },
    { $set: { customerType: 'registered' } },
    {
      $unionWith: {
        coll: 'guest_contacts',
        pipeline: [
          {
            $lookup: {
              from: 'customers',
              let: { id: '$_id', email: '$email' },
              pipeline: [
                {
                  $match: {
                    accountEnabled: true,
                    $expr: {
                      $or: [
                        { $eq: ['$_id', '$$id'] },
                        { $eq: ['$email', '$$email'] },
                      ],
                    },
                  },
                },
                { $project: { _id: 1, isActive: 1 } },
              ],
              as: 'linked',
            },
          },
          {
            $set: {
              _id: { $ifNull: [{ $arrayElemAt: ['$linked._id', 0] }, '$_id'] },
              isActive: {
                $ifNull: [
                  { $arrayElemAt: ['$linked.isActive', 0] },
                  '$isActive',
                ],
              },
              customerType: {
                $cond: [
                  { $gt: [{ $size: '$linked' }, 0] },
                  'registered',
                  'guest',
                ],
              },
              displayName: '$recipientName',
              contactSource: 'guest',
            },
          },
          { $unset: ['linked', 'phoneKey'] },
        ],
      },
    },
    { $group: { _id: '$_id', row: { $mergeObjects: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$row' } },
    { $match: filter },
    {
      $project: {
        _id: 1,
        firstName: { $ifNull: ['$firstName', ''] },
        lastName: { $ifNull: ['$lastName', ''] },
        displayName: 1,
        customerType: 1,
        contactSource: 1,
        email: 1,
        phone: 1,
        address: 1,
        shippingAddress: 1,
        birthDate: 1,
        gender: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  return {
    data: result?.data ?? [],
    pagination: buildPagination(page, limit, result?.total?.[0]?.count ?? 0),
  };
}

export async function getCustomerById(id: string) {
  const customer = await Customer.findById(id).select(
    '-__v -password -refreshToken -tokenVersion -accountId'
  );
  const contact = await GuestContacts.findOne({
    $or: [{ _id: id }, ...(customer ? [{ email: customer.email }] : [])],
  }).select('-phoneKey');
  if (!customer && !contact) throw createHttpError(404, 'Customer not found');
  if (!contact) return customer!;
  return {
    firstName: '',
    lastName: '',
    ...customer?.toObject(),
    ...contact.toObject(),
    _id: customer?._id ?? contact._id,
    customerType: customer?.accountEnabled ? 'registered' : 'guest',
    contactSource: 'guest',
    displayName: contact.recipientName,
  };
}

export const getCustomerAccounts = (query: GetCustomersQuery) =>
  getCustomers(query, true);

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput
): Promise<ICustomer | null> {
  const locality = input.address
    ? await resolveCurrentAddressNames(input.address)
    : undefined;
  return withRelationsTransaction(async (session) => {
    if (input.email) {
      const existing = await Customer.findOne({
        email: input.email,
        _id: { $ne: id },
      });
      if (existing) throw createHttpError(409, 'Email already exists');
    }

    const fields: Record<string, unknown> = { ...input };
    if (input.address) {
      const current = await Customer.findById(id).session(session);
      if (current) {
        const shipping = {
          ...addressToShipping(input.address, current),
          ...locality,
        };
        fields['shippingAddress'] = shipping;
        fields['address'] = shippingToAddress(shipping);
      }
    }
    const customer = await Customer.findByIdAndUpdate(
      id,
      {
        $set: fields,
        ...(input.isActive === false
          ? { $unset: { refreshToken: 1 }, $inc: { tokenVersion: 1 } }
          : {}),
      },
      { returnDocument: 'after', runValidators: true, session }
    ).select('-__v -password -refreshToken -tokenVersion -accountId');
    if (customer) return customer;
    const contact = await GuestContacts.findById(id).session(session);
    if (!contact) throw createHttpError(404, 'Customer not found');
    if (
      (input.email !== undefined && input.email !== contact.email) ||
      (input.phone !== undefined && input.phone !== contact.phone)
    )
      throw createHttpError(400, 'Contact email and phone cannot be changed');
    if (input.isActive !== undefined) contact.isActive = input.isActive;
    if (input.firstName !== undefined || input.lastName !== undefined)
      contact.recipientName = [input.lastName, input.firstName]
        .filter(Boolean)
        .join(' ');
    if (input.address && locality) {
      contact.shippingAddress = {
        ...contact.shippingAddress,
        ...locality,
        street: input.address.street,
      };
      contact.address = shippingToAddress(contact.shippingAddress);
    }
    await contact.save({ session });
    return {
      ...contact.toObject(),
      firstName: '',
      lastName: '',
      displayName: contact.recipientName,
      customerType: 'guest',
    };
  });
}

export async function deleteCustomer(id: string) {
  return withRelationsTransaction(async (session) => {
    if (
      await Order.exists({
        $or: [{ customerId: id }, { contactCustomerId: id }],
      }).session(session)
    )
      throw createHttpError(
        409,
        'Cannot delete a customer referenced by orders'
      );
    const customer = await Customer.findByIdAndDelete(id, { session });
    if (!customer) {
      const contact = await GuestContacts.findByIdAndDelete(id, { session });
      if (!contact) throw createHttpError(404, 'Customer not found');
      return contact;
    }
    return customer;
  });
}
