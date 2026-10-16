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