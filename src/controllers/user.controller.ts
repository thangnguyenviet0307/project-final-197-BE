import type { Request, Response, RequestHandler } from 'express';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} from '../services/user.service.js';
import { asyncHandler } from '../utils/async-handler.util.js';
import { ApiError } from '../middlewares/error.middleware.js';

interface GetUsersQuery {
  page?: string;
  limit?: string;
  search?: string;
  role?: string;
  active?: string;
}

const getUsersHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search, role, active } = req.query as GetUsersQuery;

  const result = await getUsers({
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
    search,
    role,
    active: active !== undefined ? active === 'true' : undefined,
  });

  res.status(200).json({
    success: true,
    message: 'Lấy danh sách người dùng thành công',
    data: result.data,
    pagination: result.pagination,
  });
});

const getUserByIdHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await getUserById(id as string);

  res.status(200).json({
    success: true,
    message: 'Lấy chi tiết người dùng thành công',
    data: user,
  });
});

const createUserHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = await createUser(req.body);

  res.status(201).json({
    success: true,
    message: 'Tạo người dùng thành công',
    data: {
      _id: (user as unknown as { _id: { toString: () => string } })._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      active: user.active,
    },
  });
});

const updateUserHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await updateUser(id as string, req.body);

  if (!user) throw new ApiError(404, 'Không tìm thấy người dùng');

  res.status(200).json({
    success: true,
    message: 'Cập nhật người dùng thành công',
    data: user,
  });
});

const deleteUserHandler: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await deleteUser(id as string);

  res.status(200).json({
    success: true,
    message: 'Xóa người dùng thành công',
    data: null,
  });
});

export const userController: Record<string, RequestHandler> = {
  getUsers: getUsersHandler,
  getUserById: getUserByIdHandler,
  createUser: createUserHandler,
  updateUser: updateUserHandler,
  deleteUser: deleteUserHandler,
};