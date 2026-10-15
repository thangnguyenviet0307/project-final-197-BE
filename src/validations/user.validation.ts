import { z } from "zod";

export const createUserSchema = z.object({
  body: z.object({
    fullName: z.string().min(2, "Họ tên phải có ít nhất 2 ký tự"),
    email: z.string().email("Email không hợp lệ"),
    password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
    phone: z.string().optional(),
    role: z.enum(["admin", "staff"]).default("staff"),
    status: z.enum(["active", "inactive"]).default("active"),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    phone: z.string().optional(),
    role: z.enum(["admin", "staff"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  }),
});