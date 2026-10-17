import { z } from "zod";

// Khung dữ liệu chuẩn khi người dùng đăng nhập
export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ message: "Email phải là một chuỗi ký tự!" })
      .min(1, "Email không được để trống!")
      .email("Email không đúng định dạng!"),
    password: z
      .string({ message: "Mật khẩu phải là một chuỗi ký tự!" })
      .min(1, "Mật khẩu không được để trống!")
      .min(6, "Mật khẩu phải có ít nhất 6 ký tự!"),
  }),
});

// Khung dữ liệu chuẩn khi người dùng đăng ký tài khoản mới
export const registerSchema = z.object({
  body: z.object({
    name: z
      .string({ message: "Tên phải là một chuỗi ký tự!" })
      .min(1, "Tên không được để trống!")
      .min(2, "Tên phải có ít nhất 2 ký tự!"),
    email: z
      .string({ message: "Email phải là một chuỗi ký tự!" })
      .min(1, "Email không được để trống!")
      .email("Email không đúng định dạng!"),
    password: z
      .string({ message: "Mật khẩu phải là một chuỗi ký tự!" })
      .min(1, "Mật khẩu không được để trống!")
      .min(6, "Mật khẩu phải có ít nhất 6 ký tự!"),
    role: z.enum(["admin", "staff"]).optional(),
  }),
});