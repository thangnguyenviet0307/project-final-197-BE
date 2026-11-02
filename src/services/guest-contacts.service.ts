import { type ClientSession, Types } from 'mongoose';
import createHttpError from 'http-errors';
import { Customer } from '../models/customers.model.js';
import { GuestContacts } from '../models/guest-contacts.model.js';
import { shippingToAddress } from '../utils/customer-address.js';
import type { CheckoutInput } from '../validations/checkout.validation.js';

export const normalizeContactPhone = (phone: string) => phone.replace(/[\s().-]/g, '').replace(/^\+84/, '0');

// Runs only after receipt replay checks, within the reservation/order transaction.
export async function saveGuestContact(input: CheckoutInput, locality: { province: string; district: string; ward: string }, session: ClientSession) {
  if (!input.email) throw createHttpError(400, 'Vui lòng nhập email nhận hàng.');
  const email = input.email;
  const phoneKey = normalizeContactPhone(input.phone);
  const phonePattern = new RegExp(`^(?:0|\\+84)[\\s().-]*${phoneKey.slice(1).split('').join('[\\s().-]*')}$`);
  const accounts = await Customer.find({ $or: [{ email }, { phone: phonePattern }] }).select('_id email phone').limit(3).session(session);
  const contacts = await GuestContacts.find({ $or: [{ email }, { phoneKey }] }).limit(3).session(session);
  const candidates = new Map<string, { _id: Types.ObjectId; email: string; phone: string }>();
  for (const record of [...accounts, ...contacts]) candidates.set(String(record._id), record);
  const matchingEmail = [...candidates.values()].filter(record => record.email === email);
  const matchingPhone = [...candidates.values()].filter(record => normalizeContactPhone(record.phone) === phoneKey);
  // A contact created before registration may have another ID but the same email.
  // Prefer its existing CRM record; account authentication/history stays separate.
  const emailContact = contacts.find(record => record.email === email);
  const emailMatch = emailContact ?? matchingEmail[0];
  const conflict = emailMatch
    ? matchingPhone.some(record => record.email !== emailMatch.email && String(record._id) !== String(emailMatch._id)) && !matchingPhone.some(record => String(record._id) === String(emailMatch._id))
    : matchingPhone.length > 1;
  if (conflict) throw createHttpError(409, 'Thông tin liên hệ chưa khớp. Vui lòng kiểm tra email và số điện thoại hoặc liên hệ cửa hàng.');
  const match = emailMatch ?? matchingPhone[0];
  const id = match?._id ?? new Types.ObjectId();
  const existing = contacts.find(record => String(record._id) === String(id));
  const shippingAddress = {
    recipientName: input.recipientName, email: match?.email ?? email,
    ...locality, street: input.street, deliveryTime: existing?.shippingAddress.deliveryTime ?? '',
    addressVersion: 2 as const, provinceCode: input.provinceCode, wardCode: input.wardCode,
  };
  const contact = await GuestContacts.findOneAndUpdate({ _id: id }, {
    $set: { recipientName: input.recipientName, shippingAddress, address: shippingToAddress(shippingAddress) },
    $setOnInsert: { email: match?.email ?? email, phone: match?.phone || input.phone, phoneKey: normalizeContactPhone(match?.phone || input.phone), isActive: true },
  }, { session, upsert: true, returnDocument: 'after', runValidators: true });
  return contact!;
}
