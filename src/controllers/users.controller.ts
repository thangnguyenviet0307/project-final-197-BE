import type { AuthenticatedRequest } from "../middlewares/auth.middleware.js";
import { sendResponse } from "../helpers/response.helper.js";
import type { RequestHandler } from "express";
import { UserService } from "../services/users.service.js";
import { asyncHandler } from "../utils/async-handler.util.js";
import type { GetUsersQuery } from "../types/users.type.js";
export const userController: Record<string, RequestHandler> = {
  revokeSessions: asyncHandler(async (req, res) => {
    await UserService.revokeSessions(
      String(req.params["id"]),
      (req as AuthenticatedRequest).user!,
    );
    sendResponse(res, 200, { message: "Sessions revoked" });
  }),
  transferOwnership: asyncHandler(async (req, res) => {
    await UserService.transferOwnership(
      (req as AuthenticatedRequest).user!,
      req.body.targetUserId,
      req.body.currentPassword,
    );
    sendResponse(res, 200, {
      message: "Ownership transferred; both accounts must sign in again",
    });
  }),
  getUsers: asyncHandler(async (req, res) => {
    const result = await UserService.getAllUsers(
      req.query as unknown as GetUsersQuery,
    );
    sendResponse(res, 200, {
      success: true,
      message: "Success",
      ...result,
      meta: { ...result.pagination, pages: result.pagination.totalPages },
    });
  }),
  getUserById: asyncHandler(async (req, res) => {
    sendResponse(res, 200, {
      success: true,
      message: "Success",
      data: await UserService.getUserById(String(req.params["id"])),
    });
  }),
  createUser: asyncHandler(async (req, res) => {
    sendResponse(res, 201, {
      success: true,
      message: "Success",
      data: await UserService.createUser(
        req.body,
        (req as AuthenticatedRequest).user!,
      ),
    });
  }),
  updateUser: asyncHandler(async (req, res) => {
    sendResponse(res, 200, {
      success: true,
      message: "Success",
      data: await UserService.updateUser(
        String(req.params["id"]),
        req.body,
        (req as AuthenticatedRequest).user!,
      ),
    });
  }),
  deleteUser: asyncHandler(async (req, res) => {
    await UserService.deleteUser(
      String(req.params["id"]),
      (req as AuthenticatedRequest).user!,
    );
    sendResponse(res, 200, { success: true, message: "Success", data: null });
  }),
};
