import createHttpError from "http-errors";
import type { ClientSession } from "mongoose";
import { HeroSlide } from "../models/hero-slides.model.js";
import { Categories } from "../models/categories.model.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import type { HeroSlideInput, UpdateHeroSlideInput } from "../types/hero-slides.type.js";

const activeCategory = { isActive: true, isDeleted: { $ne: true } };
async function assertCategory(category: unknown, session: ClientSession) {
  if (!await Categories.exists({ _id: category, ...activeCategory }).session(session)) {
    throw createHttpError(409, "Danh mục không tồn tại hoặc đã ngừng hoạt động.", { businessCode: "CATEGORY_UNAVAILABLE" });
  }
}
export async function listHeroSlides(publicOnly = false) {
  const filter: Record<string, unknown> = publicOnly ? { isActive: true, category: { $in: await Categories.distinct("_id", activeCategory) } } : {};
  const slides = await HeroSlide.find(filter)
    .select(publicOnly ? "_id category title description imageUrl sortOrder" : "_id category title description imageUrl sortOrder isActive __v createdAt updatedAt")
    .populate({ path: "category", select: publicOnly ? "_id name icon" : "_id name icon isActive isDeleted", ...(publicOnly ? { match: activeCategory } : {}) })
    .sort({ sortOrder: 1, _id: 1 }).limit(50).lean();
  return publicOnly ? slides.filter(slide => slide.category != null) : slides;
}
export async function createHeroSlide(input: HeroSlideInput) {
  return withRelationsTransaction(async session => {
    if (await HeroSlide.countDocuments({}).session(session) >= 50) throw createHttpError(409, "Tối đa 50 slide hero. Xóa slide không dùng trước khi thêm.");
    await assertCategory(input.category, session);
    const slide = new HeroSlide(input);
    await slide.save({ session });
    return slide.toObject();
  });
}
export async function updateHeroSlide(id: string, input: UpdateHeroSlideInput) {
  return withRelationsTransaction(async session => {
    const slide = await HeroSlide.findById(id).session(session);
    if (!slide) throw createHttpError(404, "Không tìm thấy slide.");
    const { expectedVersion, ...fields } = input;
    if ((slide.__v ?? 0) !== expectedVersion) throw createHttpError(409, "Slide đã thay đổi. Tải lại và kiểm tra trước khi lưu.", { businessCode: "VERSION_CONFLICT" });
    if (fields.category !== undefined || fields.isActive === true) await assertCategory(fields.category ?? slide.category, session);
    slide.set(fields);
    await slide.save({ session });
    return slide.toObject();
  });
}
export async function deleteHeroSlide(id: string, expectedVersion: number) {
  return withRelationsTransaction(async session => {
    const slide = await HeroSlide.findById(id).session(session);
    if (!slide) throw createHttpError(404, "Không tìm thấy slide.");
    if ((slide.__v ?? 0) !== expectedVersion) throw createHttpError(409, "Slide đã thay đổi. Tải lại trước khi xóa.", { businessCode: "VERSION_CONFLICT" });
    await HeroSlide.deleteOne({ _id: id, __v: expectedVersion }, { session });
  });
}
