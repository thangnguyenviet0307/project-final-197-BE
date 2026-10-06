import slugify from "slugify";
import { Brand, type IBrand } from "../models/brand.model.js";

export type BrandInput = {
  name: string;
  logo?: string;
  description?: string;
  isActive?: boolean;
};

const buildSlug = (name: string): string =>
  slugify(name, {
    lower: true,
    strict: true,
    trim: true,
  });

const getAllBrands = async (): Promise<IBrand[]> => {
  return Brand.find().sort({ createdAt: -1 }).lean();
};

const getBrandById = async (id: string): Promise<IBrand | null> => {
  return Brand.findById(id).lean();
};

const createBrand = async (payload: BrandInput): Promise<IBrand> => {
  const name = payload.name?.trim();

  if (!name) {
    throw new Error("Tên thương hiệu là bắt buộc");
  }

  const baseSlug = buildSlug(name);
  let slug = baseSlug;
  let counter = 1;

  while (await Brand.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const brand = await Brand.create({
    name,
    slug,
    logo: payload.logo ?? "",
    description: payload.description ?? "",
    isActive: payload.isActive ?? true,
  });

  return brand.toObject();
};

const updateBrand = async (
  id: string,
  payload: Partial<BrandInput>,
): Promise<IBrand | null> => {
  const existingBrand = await Brand.findById(id);

  if (!existingBrand) {
    return null;
  }

  const nextName = payload.name?.trim();

  const updatedData: Partial<BrandInput> & { slug?: string } = {
    ...payload,
  };

  if (nextName) {
    updatedData.name = nextName;
    const baseSlug = buildSlug(nextName);
    let slug = baseSlug;
    let counter = 1;

    while (await Brand.exists({ slug, _id: { $ne: id } })) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }

    updatedData.slug = slug;
  }

  const brand = await Brand.findByIdAndUpdate(id, updatedData, {
    new: true,
    runValidators: true,
  });

  return brand ? brand.toObject() : null;
};

const deleteBrand = async (id: string): Promise<IBrand | null> => {
  const brand = await Brand.findByIdAndDelete(id);
  return brand ? brand.toObject() : null;
};

export default {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
};
