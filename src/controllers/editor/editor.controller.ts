import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import type { RequestHandler } from 'express';
import { sendResponse } from '../../helpers/response.helper.js';
import { uploadEditorImage } from '../../services/editor/editor-image.service.js';

export const uploadImage: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 201, { data: await uploadEditorImage(req.file) });
});
