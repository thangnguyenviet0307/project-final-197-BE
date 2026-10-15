import { User } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import createError from "http-errors";

const login = async (email: string, password: string) => {
  // 1. Tìm user theo email
  const user = await User.findOne({ email });
  if (!user) {
    throw createError(404, "Email hoặc mật khẩu không chính xác!");
  }

  // 2. Kiểm tra xem tài khoản có bị khóa (inactive) hay không
  if (user.status === "inactive") {
    throw createError(403, "Tài khoản của bạn đã bị khóa, vui lòng liên hệ quản trị viên!");
  }

  // 3. So sánh mật khẩu đã mã hóa bằng bcrypt
  const isPasswordValid = await bcrypt.compare(password, user.password || "");
  if (!isPasswordValid) {
    throw createError(401, "Email hoặc mật khẩu không chính xác!");
  }

  // 4. Tạo JWT Token (chứa id và role để middleware phân quyền sử dụng)
  const secretKey = process.env["JWT_SECRET"] || "default_secret_key_123";
  const token = jwt.sign(
    { id: user._id, role: user.role },
    secretKey,
    { expiresIn: "1d" }
  );

  // 5. Trả về token và thông tin user
  return {
    token,
    user,
  };
};

/**
 * Thêm hàm register để xử lý đăng ký tài khoản mới
 */
const register = async (userData: { name: string; email: string; password: string; role?: "admin" | "staff" }) => {
  // 1. Kiểm tra xem email đã tồn tại trong database chưa
  const existingUser = await User.findOne({ email: userData.email });
  if (existingUser) {
    throw createError(400, "Email này đã được sử dụng!");
  }

  // 2. Mã hóa mật khẩu trước khi lưu xuống DB
  const hashedPassword = await bcrypt.hash(userData.password, 10);

  // 3. Tạo tài khoản mới (mặc định nếu không truyền role thì là "staff")
  const newUser = await User.create({
    fullName: userData.name,
    email: userData.email,
    password: hashedPassword,
  });

  return newUser;
};

export default {
  login,
  register, // Đã bổ sung register vào đây để controller gọi được
};