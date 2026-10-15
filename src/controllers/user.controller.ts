import type { Request, Response, RequestHandler } from "express";
import { UserService } from "../services/user.service.js";
import { asyncHandler } from "../utils/async-handler.util.js";

export const UserController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await UserService.loginUser(req.body);
    res.status(200).json({
      success: true,
      ...result,
    });
  }) as RequestHandler,

  getAll: asyncHandler(async (_req: Request, res: Response) => {
    const users = await UserService.getAllUsers();
    res.status(200).json({
      success: true,
      data: users,
    });
  }) as RequestHandler,

  getById: asyncHandler(async (req: Request, res: Response) => {
    const rawId = req.params["id"];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const user = await UserService.getUserById(id!);
    res.status(200).json({
      success: true,
      data: user,
    });
  }) as RequestHandler,

  create: asyncHandler(async (req: Request, res: Response) => {
    const newUser = await UserService.createUser(req.body);
    res.status(201).json({
      success: true,
      message: "Tạo user thành công",
      data: newUser,
    });
  }) as RequestHandler,

  update: asyncHandler(async (req: Request, res: Response) => {
    const rawId = req.params["id"];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const updatedUser = await UserService.updateUser(id!, req.body);
    res.status(200).json({
      success: true,
      message: "Cập nhật user thành công",
      data: updatedUser,
    });
  }) as RequestHandler,

  delete: asyncHandler(async (req: Request, res: Response) => {
    const rawId = req.params["id"];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const result = await UserService.deleteUser(id!);
    res.status(200).json({
      success: true,
      ...result,
    });
  }) as RequestHandler,
};