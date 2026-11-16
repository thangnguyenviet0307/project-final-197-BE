import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import type { RequestHandler } from 'express';
import { sendResponse } from '../../helpers/response.helper.js';
import { uploadEditorImage } from '../../services/editor/editor-image.service.js';
import createError from 'http-errors';

export const uploadImage: RequestHandler = asyncHandler(async (req, res) => {
  const kind = req.query['kind'] ?? 'editor';
  if (kind !== 'editor' && kind !== 'articles' && kind !== 'hero')
    throw createError(400, 'Invalid image destination');
  sendResponse(res, 201, { data: await uploadEditorImage(req.file, kind) });
});
