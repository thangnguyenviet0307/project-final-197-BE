import type { Types } from "mongoose";

export interface BaseDocument {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
export interface IPaginationQuery {
  page: number;
  limit: number;
}

// Explicit undefined matches optional fields returned by Zod under strict optional typing.
export type OptionalUpdate<T> = { [K in keyof T]?: T[K] | undefined };
