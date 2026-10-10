import { buildSlug } from "../helpers/buildSlug.helper.js";
import Product from "../models/product.model.js";

export type ProductInput = {
  product_name: string;
  price?: number;
  discount?: number;
  category: string;
  brand: string;
  description?: string | null;
  model_year: number;
  slug?: string;
  thumbnail?: string | null;
  stock?: number;
};

const getAllProducts = async (): Promise<any[]> => {
  return Product.find()
    .sort({ createdAt: -1 })
    .populate("brand category")
    .lean();
};

const getProductById = async (id: string): Promise<any | null> => {
  return Product.findById(id).populate("brand category").lean();
};

const createProduct = async (payload: ProductInput): Promise<any> => {
  const name = payload.product_name?.trim();

  if (!name) {
    throw new Error("Tên sản phẩm là bắt buộc");
  }

  const baseSlug = payload.slug?.trim() || buildSlug(name);
  let slug = baseSlug;
  let counter = 1;

  while (await Product.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const product = await Product.create({
    ...payload,
    product_name: name,
    slug,
  });

  return product.toObject();
};

const updateProduct = async (
  id: string,
  payload: Partial<ProductInput>,
): Promise<any | null> => {
  const existing = await Product.findById(id);

  if (!existing) return null;

  const nextName = payload.product_name?.trim();

  const updated: Partial<ProductInput> & { slug?: string } = {
    ...payload,
  };

  if (nextName) {
    updated.product_name = nextName;
    const baseSlug = payload.slug?.trim() || buildSlug(nextName);
    let slug = baseSlug;
    let counter = 1;

    while (await Product.exists({ slug, _id: { $ne: id } })) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }

    updated.slug = slug;
  }

  const product = await Product.findByIdAndUpdate(id, updated, {
    new: true,
    runValidators: true,
  });

  return product ? product.toObject() : null;
};

const deleteProduct = async (id: string): Promise<any | null> => {
  const product = await Product.findByIdAndDelete(id);
  return product ? product.toObject() : null;
};

export default {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
