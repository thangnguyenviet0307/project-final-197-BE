import type { RequestHandler, Request } from 'express';
import { asyncHandler } from '../../utils/shared/async-handler.util.js';
import { sendResponse } from '../../helpers/response.helper.js';
import { documentParams } from '../../validations/support/managed-document.validation.js';
import * as service from '../../services/support/managed-document.service.js';

const key = (req: Request) => documentParams.parse(req.params).key;
export const list: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listDocuments() });
});
export const detail: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.readDocument(key(req), true) });
});
export const publicDetail: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.readDocument(key(req)) });
});
export const save: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await service.writeDocument(key(req), req.body),
  });
});
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, {
    data: await service.writeDocument(
      key(req),
      {
        content: '',
        publish: false,
        expectedVersion: req.body.expectedVersion,
      },
      true
    ),
  });
});
export const view: RequestHandler = asyncHandler(async (req, res) => {
  sendResponse(res, 200, { data: await service.recordDocumentView(key(req)) });
});
