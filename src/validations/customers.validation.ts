import { z } from "zod";

export const createCustomerSchema = z.object({
  first_name: z.string().trim().min(1).max(50),

  last_name: z.string().trim().min(1).max(50),

  phone: z.string().trim().min(1).max(50),

  email: z.email().max(150),

  birthday: z.coerce.date().nullish(),

  street: z.string().trim().min(1).max(255),

  city: z.string().trim().min(1).max(50),

  state: z.string().trim().min(1).max(50),

  password: z.string().min(8).max(72).nullish(),
}).strict();

export const updateCustomerSchema =
  createCustomerSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required",
    }
  );

export type CreateCustomerInput =
  z.infer<typeof createCustomerSchema>;

export type UpdateCustomerInput =
  z.infer<typeof updateCustomerSchema>;