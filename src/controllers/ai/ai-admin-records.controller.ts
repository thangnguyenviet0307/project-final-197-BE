import type { RequestHandler } from 'express';
import createError from 'http-errors';
import {
  recordKind,
  recordPaging,
  recordDeletion,
  recordId,
} from '../../validations/ai/ai-admin-records.validation.js';
import type { AuthenticatedRequest } from '../../middlewares/auth/auth.middleware.js';
import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import { sendResponse } from '../../helpers/response.helper.js';
import {
  readAdminRecords,
  deleteAdminRecord,
} from '../../services/ai/admin-records.service.js';

export const read: RequestHandler = asyncHandler(async (req, res) => {
  const kind = recordKind.parse(req.params['kind']);
  const { page, limit } = recordPaging.parse(req.query);
  res.setHeader('Cache-Control', 'no-store');
  sendResponse(res, 200, { data: await readAdminRecords(kind, page, limit) });
});
export const remove: RequestHandler = asyncHandler(
  async (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'super_admin')
      throw createError(403, 'Chỉ Super Admin được xóa bản ghi quản trị AI.');
    const kind = recordKind.parse(req.params['kind']);
    const id = recordId.parse(req.params['id']);
    const { version } = recordDeletion.parse(req.body);
    await deleteAdminRecord(kind, id, version);
    res.setHeader('Cache-Control', 'no-store');
    sendResponse(res, 200, {
      message: 'Đã xóa bản ghi khỏi danh sách quản trị.',
    });
  }
);
