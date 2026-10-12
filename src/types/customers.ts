import type { Types } from "mongoose";
import type { BaseDocument } from "./common.types.js";

export interface ICustomerAddress {
  recipientName: string;
  phone: string;
  province: string;
  ward: string;
  detail: string;
  isDefault?: boolean;
}

export interface ICustomer {
  userId?: Types.ObjectId;
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  gender?: "male" | "female" | "other";
  dateOfBirth?: Date;
  addresses?: ICustomerAddress[];
  isActive?: boolean;
  isDeleted?: boolean;
  deletedAt?: Date | null;
}

export type ICustomerDocument = ICustomer & BaseDocument;