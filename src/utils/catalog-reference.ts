import type { ClientSession } from "mongoose";
import createHttpError from "http-errors";
import { BrandModel } from "../models/brands.model.js";
import { Categories } from "../models/categories.model.js";

export async function assertActiveCatalog(brand: unknown, category: unknown, session?: ClientSession) {
  const brandQuery = BrandModel.exists({ _id: brand, isDeleted: { $ne: true }, isActive: { $ne: false } });
  const categoryQuery = Categories.exists({ _id: category, isDeleted: { $ne: true }, isActive: { $ne: false } });
  if (session) { brandQuery.session(session); categoryQuery.session(session); }
  if (!await brandQuery) throw createHttpError(409, "Brand is missing or inactive");
  if (!await categoryQuery) throw createHttpError(409, "Category is missing or inactive");
}
