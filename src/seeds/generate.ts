import type mongoose from 'mongoose';
import { faker } from '@faker-js/faker';
import { BrandModel } from '../models/brands.model.js';
import { Categories } from '../models/categories.model.js';
import Product from '../models/products.model.js';
import { ProductReview } from '../models/product-reviews.model.js';
import { sumVariantStock } from '../utils/inventory.js';
import { createNameAllocator, type ExistingCatalog } from './names.js';
import { createBrandSchema } from '../validations/brands.validation.js';
import { createCategoriesSchema } from '../validations/categories.validation.js';
import { createProductSchema } from '../validations/products.validation.js';

/** Shared metadata for new and legacy native Faker products (kg, cm, VND). */
export function generateProductMetadata(sku: string, categorySlug: string, index = 0) {
  return {
      sku: sku,
      barcode: `0${faker.string.numeric(12)}`,
      currency: 'VND',
      tags: [categorySlug, 'seed', index % 2 === 0 ? 'featured' : 'new-arrival'],
      weight: faker.number.float({ min: 0.1, max: 5, fractionDigits: 2 }),
      dimensions: {
        width: faker.number.float({ min: 5, max: 50, fractionDigits: 1 }),
        height: faker.number.float({ min: 2, max: 40, fractionDigits: 1 }),
        depth: faker.number.float({ min: 2, max: 30, fractionDigits: 1 }),
      },
      warrantyInformation: index % 3 === 0 ? 'Không áp dụng bảo hành.' : 'Bảo hành 12 tháng theo chính sách cửa hàng.',
      shippingInformation: 'Dự kiến giao trong 2–5 ngày làm việc; phí vận chuyển xác nhận khi đặt hàng.',
      returnPolicy: 'Hỗ trợ đổi trả trong 30 ngày theo điều kiện của cửa hàng.',
      minimumOrderQuantity: index % 5 === 0 ? 3 : 1,
  };
}

export function generateProductReview(product: mongoose.Types.ObjectId, reviewerName: string, now = new Date()) {
  const rating = faker.helpers.arrayElement([2, 3, 4, 4, 5, 5]);
  return new ProductReview({
    product, rating, reviewerName: reviewerName.slice(0, 100),
    comment: rating >= 4 ? 'S?n ph?m ??ng m? t?, ??ng g?i c?n th?n. T?i h?i l?ng v?i tr?i nghi?m mua h?ng.' : 'S?n ph?m s? d?ng ???c nh?ng c?n c?i thi?n ch?t l??ng v? th?i gian giao h?ng.',
    date: faker.date.between({ from: new Date(now.getTime() - 60 * 86400000), to: now }),
    source: 'admin',
  });
}

/** Build and validate documents without connecting to MongoDB. */
export async function generateSeedData(existing: ExistingCatalog = {}) {
  const batch = faker.string.uuid();
  const now = new Date();
  const brandName = createNameAllocator(existing.brands, 100);
  const categoryName = createNameAllocator(existing.categories);
  const productName = createNameAllocator(existing.products);
  const brands = Array.from({ length: 8 }, () => new BrandModel({
    seedBatch: batch,
    ...brandName(faker.company.name()),
    description: faker.company.catchPhrase(), logoUrl: faker.image.url(), isActive: true,
  }));
  const departments = faker.helpers.arrayElements([
    'Computers', 'Phones', 'Accessories', 'Clothing', 'Shoes', 'Sports',
    'Beauty', 'Home', 'Books', 'Music', 'Toys', 'Electronics',
  ], 10);
  const categories = departments.map(name => new Categories({
    seedBatch: batch,
    ...categoryName(name),
    description: faker.lorem.sentence(), icon: faker.image.url(), isActive: true,
  }));
  for (const category of categories.slice(5)) category.parent = faker.helpers.arrayElement(categories.slice(0, 5))._id;
  const products = Array.from({ length: 50 }, (_, i) => {
    const price = faker.number.int({ min: 10, max: 5000 }) * 1000;
    // Existing unique multikey SKU indexes may allow only one null/missing key.
    // Give every seeded product a variant to avoid conflicting with legacy data.
    const thumbnail = faker.image.url();
    const variants = Array.from({ length: i % 3 === 0 ? 1 : 3 }, (_, v) => ({
      sku: `SEED-${batch.toUpperCase()}-${i}-${v}`, variant_name: `Option ${v + 1}`,
      color: faker.color.human(), size: ['S', 'M', 'L'][v],
      price: price + v * 10000, compare_at_price: price + 100000,
      stock: faker.number.int({ min: 100, max: 200 }), attributes: { material: faker.commerce.productMaterial() },
      image: thumbnail, images: [thumbnail],
    }));
    const identity = productName(faker.commerce.productName());
    const category = faker.helpers.arrayElement(categories);
    return new Product({
      seedBatch: batch,
      product_name: identity.name, slug: identity.slug,
      ...generateProductMetadata(`SEED-${batch.toUpperCase()}-PRODUCT-${i}`, category.slug, i),
      price, discount: faker.number.int({ min: 0, max: 50 }),
      category: category._id, brand: faker.helpers.arrayElement(brands)._id,
      description: faker.commerce.productDescription(), model_year: i % 3 === 0 ? null : now.getFullYear(),
      thumbnail, stock: sumVariantStock(variants),
      is_active: true, variants,
      // External placeholder URLs must not masquerade as managed Cloudinary assets.
      images: [],
    });
  });
  const data = { brands, categories, products };
  // API validation catches constraints not present in Mongoose (lengths, URLs, SKU).
  // JSON serialization converts ObjectIds into the string IDs expected by the API.
  const input = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
  for (const brand of brands) createBrandSchema.parse(input(brand));
  for (const category of categories) createCategoriesSchema.parse(input(category));
  for (const product of products) createProductSchema.parse(input(product));
  for (const documents of Object.values(data)) {
    for (const document of documents) await document.validate();
  }
  return data;
}
