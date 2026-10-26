import { faker } from '@faker-js/faker';
import argon2 from 'argon2';
import { BrandModel } from '../models/brands.model.js';
import { Categories } from '../models/categories.model.js';
import { Customer } from '../models/customers.model.js';
import { User } from '../models/users.model.js';
import Product from '../models/products.model.js';
import { Order } from '../models/orders.model.js';
import { OrderStatus, PaymentType } from '../types/orders.type.js';
import { sumVariantStock } from '../utils/inventory.js';
import { createNameAllocator, type ExistingCatalog } from './names.js';
import { createBrandSchema } from '../validations/brands.validation.js';
import { createCategoriesSchema } from '../validations/categories.validation.js';
import { createCustomerSchema } from '../validations/customers.validation.js';
import { createUserSchema } from '../validations/users.validation.js';
import { createProductSchema } from '../validations/products.validation.js';
import { createOrderSchema } from '../validations/orders.validation.js';

/** Build and validate documents without connecting to MongoDB. */
export async function generateSeedData(password: string, existing: ExistingCatalog = {}) {
  createUserSchema.shape.password.parse(password);
  const batch = faker.string.uuid();
  const now = new Date();
  const day = 86400000;
  const phones = new Set<string>();
  const phone = () => {
    let value: string;
    do { value = `09${faker.string.numeric(8)}`; } while (phones.has(value));
    phones.add(value);
    return value;
  };
  const passwordHash = await argon2.hash(password);
  const brandName = createNameAllocator(existing.brands, 100);
  const categoryName = createNameAllocator(existing.categories);
  const productName = createNameAllocator(existing.products);
  const brands = Array.from({ length: 8 }, () => new BrandModel({
    ...brandName(faker.company.name()),
    description: faker.company.catchPhrase(), logoUrl: faker.image.url(), isActive: true,
  }));
  const departments = faker.helpers.arrayElements([
    'Computers', 'Phones', 'Accessories', 'Clothing', 'Shoes', 'Sports',
    'Beauty', 'Home', 'Books', 'Music', 'Toys', 'Electronics',
  ], 10);
  const categories = departments.map(name => new Categories({
    ...categoryName(name),
    description: faker.lorem.sentence(), icon: faker.image.url(), isActive: true,
  }));
  for (const category of categories.slice(5)) category.parent = faker.helpers.arrayElement(categories.slice(0, 5))._id;
  const customers = Array.from({ length: 30 }, (_, i) => new Customer({
    firstName: faker.person.firstName().slice(0, 50), lastName: faker.person.lastName().slice(0, 50),
    email: `seed-customer-${batch}-${i}@example.com`,
    phone: phone(),
    address: { street: faker.location.streetAddress().slice(0, 255), city: faker.location.city().slice(0, 50), state: faker.location.state().slice(0, 50) },
    isActive: true,
  }));
  const users = Array.from({ length: 6 }, (_, i) => new User({
    email: `seed-user-${batch}-${i}@example.com`, password: passwordHash,
    firstName: faker.person.firstName().slice(0, 50), lastName: faker.person.lastName().slice(0, 50),
    personalEmail: `seed-personal-${batch}-${i}@example.com`, phone: phone(),
    location: faker.location.city(), bio: faker.lorem.sentence(), avatar: faker.image.avatar(),
    role: i === 0 ? 'admin' : 'staff', active: true, mustChangePassword: true,
  }));
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
    return new Product({
      product_name: identity.name, slug: identity.slug,
      price, discount: faker.number.int({ min: 0, max: 50 }),
      category: faker.helpers.arrayElement(categories)._id, brand: faker.helpers.arrayElement(brands)._id,
      description: faker.commerce.productDescription(), model_year: new Date().getFullYear(),
      thumbnail, stock: sumVariantStock(variants),
      is_active: true, variants,
      // External placeholder URLs must not masquerade as managed Cloudinary assets.
      images: [],
    });
  });
  const orders = Array.from({ length: 40 }, (_, i) => {
    const customer = faker.helpers.arrayElement(customers);
    const status = [OrderStatus.Pending, OrderStatus.Processing, OrderStatus.Rejected, OrderStatus.Completed][i % 4]!;
    // Completed orders must have enough history for a past completion timestamp.
    const orderDate = faker.date.between({ from: new Date(now.getTime() - 90 * day), to: new Date(now.getTime() - 3 * day) });
    const plannedShippingDate = new Date(orderDate.getTime() + day);
    const orderItems = faker.helpers.arrayElements(products, { min: 1, max: 3 }).map(product => {
      const variant = product.variants.length ? faker.helpers.arrayElement(product.variants) : undefined;
      const quantity = faker.number.int({ min: 1, max: 3 });
      if (status !== OrderStatus.Rejected) {
        if (variant) {
          variant.stock -= quantity;
          product.stock = sumVariantStock(product.variants);
        } else product.stock -= quantity;
      }
      return {
        productId: product._id, productName: product.product_name,
        quantity, price: variant?.price ?? product.price, discount: product.discount,
        ...(variant ? { variantId: variant._id, sku: variant.sku, variantName: variant.variant_name,
          selectedOptions: { ...variant.attributes, color: variant.color, size: variant.size } } : {}),
      };
    });
    const shippingDate = new Date(orderDate.getTime() + 2 * day);
    return new Order({
      customerId: customer._id,
      customerSnapshot: { firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
      orderStatus: status, orderDate, requireDate: new Date(orderDate.getTime() + 7 * 86400000),
      ...(status === OrderStatus.Processing || status === OrderStatus.Completed
        ? { userId: users[1 + Math.floor(i / 4) % 5]!._id, plannedShippingDate } : {}),
      ...(status === OrderStatus.Completed ? { shippingDate } : {}),
      ...(status === OrderStatus.Rejected ? { cancellationReason: faker.lorem.sentence() } : {}),
      orderNote: faker.lorem.sentence(), ...customer.address, paymentType: PaymentType.COD, orderItems,
      createdAt: orderDate,
      updatedAt: status === OrderStatus.Completed ? shippingDate : orderDate,
    });
  });
  const data = { brands, categories, customers, users, products, orders };
  // API validation catches constraints not present in Mongoose (lengths, URLs, SKU).
  // JSON serialization converts ObjectIds into the string IDs expected by the API.
  const input = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
  for (const brand of brands) createBrandSchema.parse(input(brand));
  for (const category of categories) createCategoriesSchema.parse(input(category));
  for (const customer of customers) createCustomerSchema.parse(input(customer));
  for (const user of users) createUserSchema.parse({ ...user.toObject(), password });
  for (const product of products) createProductSchema.parse(input(product));
  for (const order of orders) createOrderSchema.parse(input(order));
  for (const documents of Object.values(data)) {
    for (const document of documents) await document.validate();
  }
  return data;
}
