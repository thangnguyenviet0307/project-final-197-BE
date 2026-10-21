import { z } from 'zod';

export const userRoleSchema = z.enum(["admin", "staff"]);
export const discountSchema = z.number().min(0).max(70);
export const hasUpdateFields = (data: object): boolean => Object.keys(data).length > 0;
export const UPDATE_REQUIRED_MESSAGE = "At least one field is required for update";

export function createEmailSchema(message?: string) {
  return z.string().trim().check(z.email(message)).toLowerCase();
}

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ObjectId không hợp lệ');

export const idParamSchema = z.object({ id: objectId });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export function createAddressSchema(messages: { street?: string; city?: string; state?: string } = {}) {
  return z.object({
    street: z.string().trim().min(1, messages.street).max(255),
    city: z.string().trim().min(1, messages.city).max(50),
    state: z.string().trim().min(1, messages.state).max(50),
  });
}
