import type { IPaginationQuery } from "./common.types.js";
export interface IAddress {
  street: string;
  city: string;
  state: string;
}

export interface ICustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: IAddress;
  isActive: boolean;
}
export interface CreateCustomerInput extends ICustomer {}
export interface UpdateCustomerInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: IAddress | undefined;
  isActive?: boolean | undefined;
}
export interface GetCustomersQuery extends IPaginationQuery {
  search?: string | undefined;
  isActive?: boolean | undefined;
}
