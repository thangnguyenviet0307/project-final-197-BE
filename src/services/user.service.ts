import { User, type IUser } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken"; // <-- 1. Import jsonwebtoken
import createHttpError from "http-errors";

export const UserService = {
  // Lấy danh sách toàn bộ user (ẩn mật khẩu đi)
  async getAllUsers() {
    return await User.find().select("-password");
  },

  // Lấy chi tiết 1 user theo ID
  async getUserById(userId: string) {
    const user = await User.findById(userId).select("-password");
    if (!user) throw createHttpError(404, "Không tìm thấy người dùng");
    return user;
  },

  // Tạo mới user
  async createUser(userData: Partial<IUser>) {
    // Kiểm tra nếu có truyền email thì mới query tìm kiếm
    if (userData.email) {
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser)
        throw createHttpError(400, "Email đã tồn tại trong hệ thống");
    }

    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    }

    const newUser = new User(userData);
    return await newUser.save();
  },

  // --- 2. THÊM HÀM LOGIN NÀY VÀO ---
  async loginUser(loginData: { email: string; password: string }) {
    if (!loginData.email || !loginData.password) {
      throw createHttpError(400, "Vui lòng cung cấp đầy đủ email và mật khẩu!");
    }

    // Tìm user theo email (cần lấy cả trường password vì trong model có thể bị select: false)
    const user = await User.findOne({ email: loginData.email }).select(
      "+password",
    );
    if (!user) {
      throw createHttpError(401, "Email hoặc mật khẩu không chính xác!");
    }

    // So sánh mật khẩu
    const hashedPassword = user.password as string;
    const isPasswordValid = await bcrypt.compare(
      loginData.password,
      hashedPassword,
    );
    if (!isPasswordValid) {
      throw createHttpError(401, "Email hoặc mật khẩu không chính xác!");
    }

    // Tạo JWT Token
    const secretKey = process.env["JWT_SECRET"] || "default_secret_key_123";
    const token = jwt.sign(
      {
        id: user._id.toString(),
        role: user.role,
      },
      secretKey,
      { expiresIn: "1d" }, // Token có hạn 1 ngày
    );

    return {
      message: "Đăng nhập thành công",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
    };
  },

  // Cập nhật thông tin user
  async updateUser(userId: string, updateData: Partial<IUser>) {
    if (updateData.password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password, salt);
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    }).select("-password");
    if (!updatedUser)
      throw createHttpError(404, "Không tìm thấy người dùng để cập nhật");
    return updatedUser;
  },

  // Xóa user
  async deleteUser(userId: string) {
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser)
      throw createHttpError(404, "Không tìm thấy người dùng để xóa");
    return { message: "Xóa người dùng thành công" };
  },
};
