import type { Request, Response } from "express";
import argon2 from "argon2";
import createHttpError from "http-errors";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/async-handler.util.js";

export const userController: Record<string, any> = {
  getUsers: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as Record<string, string | string[] | undefined>;
    const page = Number(query["page"] ?? 1);
    const limit = Number(query["limit"] ?? 10);
    const search = String(query["search"] ?? "").trim();

    const filter: Record<string, unknown> = {};
    if (search) {
      (filter as Record<string, unknown>)["$or"] = [
        { firstName: new RegExp(search, "i") },
        { lastName: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-password"),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: users,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }),

  getUserById: asyncHandler(async (req: Request, res: Response) => {
    const user = await User.findById(req.params["id"]).select("-password");
    if (!user) {
      throw createHttpError(404, "Không tìm thấy người dùng");
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  }),

  createUser: asyncHandler(async (req: Request, res: Response) => {
    const { email, password, firstName, lastName, role, active } = req.body;

    const existed = await User.findOne({ email });
    if (existed) {
      throw createHttpError(409, "Email đã tồn tại trong hệ thống");
    }

    const hashedPassword = await argon2.hash(password);
    const newUser = await User.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role ?? "staff",
      active: active ?? true,
    });

    const userObject = newUser.toObject() as Record<string, any>;
    delete userObject["password"];

    res.status(201).json({
      success: true,
      message: "Tạo người dùng thành công",
      data: userObject,
    });
  }),

  updateUser: asyncHandler(async (req: Request, res: Response) => {
    const { password, ...rest } = req.body;
    const updateData: Record<string, unknown> = { ...rest };

    if (password) {
      updateData["password"] = await argon2.hash(password);
    }

    const user = await User.findByIdAndUpdate(req.params["id"], updateData, {
      new: true,
    }).select("-password");
    if (!user) {
      throw createHttpError(404, "Không tìm thấy người dùng để cập nhật");
    }

    res.status(200).json({
      success: true,
      message: "Cập nhật người dùng thành công",
      data: user,
    });
  }),

  deleteUser: asyncHandler(async (req: Request, res: Response) => {
    const user = await User.findByIdAndDelete(req.params["id"]);
    if (!user) {
      throw createHttpError(404, "Không tìm thấy người dùng để xóa");
    }

    res.status(200).json({
      success: true,
      message: "Xóa người dùng thành công",
      data: null,
    });
  }),
};
