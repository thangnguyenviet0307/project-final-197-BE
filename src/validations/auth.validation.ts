import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Email không hợp lệ"),
    password: z.string().trim().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
  }),
});

export const bootstrapSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Email không hợp lệ"),
    password: z.string().trim().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
    firstName: z.string().trim().min(1, "Tên không được để trống"),
    lastName: z.string().trim().min(1, "Họ không được để trống"),
    role: z.enum(["admin", "staff"]).default("admin"),
    active: z.boolean().default(true),
  }),
});
