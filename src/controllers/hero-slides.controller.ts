import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.util.js";
import { sendResponse } from "../helpers/response.helper.js";
import * as service from "../services/hero-slides.service.js";

export const publicHeroSlides: RequestHandler = asyncHandler(
  async (_req, res) => {
    sendResponse(res, 200, { data: await service.listHeroSlides(true) });
  },
);
export const heroSlides: RequestHandler = asyncHandler(async (_req, res) => {
  sendResponse(res, 200, { data: await service.listHeroSlides() });
});
export const createHeroSlide: RequestHandler = asyncHandler(
  async (req, res) => {
    sendResponse(res, 201, { data: await service.createHeroSlide(req.body) });
  },
);
export const updateHeroSlide: RequestHandler = asyncHandler(
  async (req, res) => {
    sendResponse(res, 200, {
      data: await service.updateHeroSlide(req.params["id"] as string, req.body),
    });
  },
);
export const deleteHeroSlide: RequestHandler = asyncHandler(
  async (req, res) => {
    await service.deleteHeroSlide(
      req.params["id"] as string,
      req.body.expectedVersion,
    );
    sendResponse(res, 200, { success: true });
  },
);
