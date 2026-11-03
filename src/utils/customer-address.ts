import type { IAddress, ICustomer } from '../types/customers.type.js';

export function shippingToAddress(
  shipping: Pick<
    NonNullable<ICustomer['shippingAddress']>,
    'street' | 'ward' | 'province'
  >
): IAddress {
  return {
    street: shipping.street,
    city: shipping.ward,
    state: shipping.province,
  };
}

export function addressToShipping(
  address: IAddress,
  customer: Pick<
    ICustomer,
    'shippingAddress' | 'firstName' | 'lastName' | 'email'
  >
): NonNullable<ICustomer['shippingAddress']> {
  return {
    recipientName:
      customer.shippingAddress?.recipientName ||
      `${customer.lastName} ${customer.firstName}`.trim(),
    email: customer.shippingAddress?.email || customer.email,
    deliveryTime: customer.shippingAddress?.deliveryTime ?? '',
    province: address.state,
    district: '',
    ward: address.city,
    street: address.street,
  };
}
