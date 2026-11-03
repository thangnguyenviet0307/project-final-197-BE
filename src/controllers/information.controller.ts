import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.util.js';
import { sendResponse } from '../helpers/response.helper.js';
import * as service from '../services/information.service.js';

export const publicInformation: RequestHandler = asyncHandler(
  async (req, res) => {
    sendResponse(res, 200, {
      data: await service.getInformation(String(req.params['slug'])),
    });
  }
);
export const adminInformation: RequestHandler = asyncHandler(
  async (req, res) => {
    sendResponse(res, 200, {
      data: await service.getInformation(String(req.params['slug']), true),
    });
  }
);
export const saveInformation: RequestHandler = asyncHandler(
  async (req, res) => {
    sendResponse(res, 200, {
      data: await service.saveInformation(String(req.params['slug']), req.body),
    });
  }
);
