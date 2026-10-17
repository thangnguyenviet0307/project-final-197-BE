import { sendResponse } from "../helpers/response.helper.js";
import type { RequestHandler } from "express";
import { UserService } from "../services/user.service.js";
import { asyncHandler } from "../utils/async-handler.util.js";
import type { GetUsersQuery } from "../validations/user.validation.js";
export const userController: Record<string, RequestHandler> = {
  getUsers: asyncHandler(async (req, res) => {
    const result = await UserService.getAllUsers(req.query as unknown as GetUsersQuery);
    sendResponse(res, 200, { success: true, message: "Success", ...result,
      meta: { ...result.pagination, pages: result.pagination.totalPages } });
  }),
  getUserById: asyncHandler(async (req, res) => {
    sendResponse(res, 200, { success: true, message: "Success", data: await UserService.getUserById(String(req.params["id"])) });
  }),
  createUser: asyncHandler(async (req, res) => {
    sendResponse(res, 201, { success: true, message: "Success", data: await UserService.createUser(req.body) });
  }),
  updateUser: asyncHandler(async (req, res) => {
    sendResponse(res, 200, { success: true, message: "Success", data: await UserService.updateUser(String(req.params["id"]), req.body) });
  }),
  deleteUser: asyncHandler(async (req, res) => {
    await UserService.deleteUser(String(req.params["id"]));
    sendResponse(res, 200, { success: true, message: "Success", data: null });
  }),
};
