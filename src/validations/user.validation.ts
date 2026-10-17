import { z } from "zod";

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Email không hợp lệ"),
    password: z.string().trim().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
    firstName: z.string().trim().min(1, "Tên không được để trống"),
    lastName: z.string().trim().min(1, "Họ không được để trống"),
    role: z.enum(["admin", "staff"]).default("staff"),
    active: z.boolean().default(true),
  }),
});

export type CreateUserInput = z.infer<typeof createUserSchema>["body"];

export const updateUserSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Email không hợp lệ").optional(),
    password: z
      .string()
      .trim()
      .min(6, "Mật khẩu phải có ít nhất 6 ký tự")
      .optional(),
    firstName: z.string().trim().min(1, "Tên không được để trống").optional(),
    lastName: z.string().trim().min(1, "Họ không được để trống").optional(),
    role: z.enum(["admin", "staff"]).optional(),
    active: z.boolean().optional(),
  }),
});

export const getUsersQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().optional(),
  }),
});
