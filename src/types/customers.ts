
import type { Document } from "mongoose";

export interface ICustomer extends Document {
  customer_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  birthday?: Date | null;
  street: string;
  city: string;
  state: string;
  zip_code?: string | null;
  password?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
