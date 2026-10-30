import { sumVariantStock } from "../utils/inventory.js";
import createHttpError from "http-errors";
import type { ClientSession } from "mongoose";
import Product from "../models/products.model.js";
import { assertActiveCatalog } from "../utils/catalog-reference.js";
import { calculateOrderTotal } from "../utils/order-total.js";
import type { IOrderItem, OrderItemInput } from "../types/orders.type.js";

export async function restoreOrderStock(items: IOrderItem[], session: ClientSession) {
  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) throw createHttpError(409, "Cannot restore a deleted product");
    if (item.variantId) {
      const variant = product.variants.id(item.variantId);
      if (!variant) throw createHttpError(409, "Cannot restore a deleted variant");
      variant.stock += item.quantity;
      product.stock = sumVariantStock(product.variants);
    } else {
      if (product.variants.length) throw createHttpError(409, "Legacy order needs variant reconciliation before cancellation");
      product.stock += item.quantity;
    }
    await product.save({ session });
  }
}

export async function reserveOrderItems(items: (OrderItemInput & { expectedUnitPrice?: number })[], session: ClientSession): Promise<IOrderItem[]> {
  const merged = new Map<string, OrderItemInput>();
  const quantities = new Map<string, number>();
  for (const item of items) {
    const productId = item.productId.toLowerCase();
    const variantId = item.variantId?.toLowerCase();
    const key = `${productId}:${variantId ?? ""}`;
    const quantity = (merged.get(key)?.quantity ?? 0) + item.quantity;
    const total = (quantities.get(productId) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(total)) throw createHttpError(400, "Total quantity is too large");
    merged.set(key, { productId, variantId, quantity });
    quantities.set(productId, total);
  }
  const orderItems: IOrderItem[] = [];
  for (const item of merged.values()) {
    const product = await Product.findById(item.productId).session(session);
    if (!product || !product.is_active) throw createHttpError(404, "Active product not found");
    if (product.on_sale === false) throw createHttpError(409, "Sản phẩm đã ngừng bán. Vui lòng kiểm tra lại giỏ hàng.");
    if ((quantities.get(item.productId) ?? 0) < (product.minimumOrderQuantity ?? 1)) throw createHttpError(400, "Quantity is below the product minimum order quantity");
    await assertActiveCatalog(product.brand, product.category, session);
    const variant = item.variantId ? product.variants.id(item.variantId) : null;
    if (product.variants.length && !item.variantId) throw createHttpError(400, "Select a product variant");
    if (item.variantId && !variant) throw createHttpError(404, "Variant not found");
    const expected = items.find(line => line.productId.toLowerCase() === item.productId && (line.variantId?.toLowerCase() ?? "") === (item.variantId ?? ""))?.expectedUnitPrice;
    if (expected !== undefined && calculateOrderTotal([{ price: variant?.price ?? product.price, discount: product.discount, quantity: 1 }]) !== expected) throw createHttpError(409, "Giá sản phẩm đã thay đổi. Vui lòng quay lại giỏ hàng, kiểm tra giá mới và xác nhận lại.");
    if ((variant?.stock ?? product.stock) < item.quantity) throw createHttpError(409, "Insufficient stock");
    if (variant) { variant.stock -= item.quantity; product.stock = sumVariantStock(product.variants); }
    else product.stock -= item.quantity;
    await product.save({ session });
    orderItems.push({ productId: product._id, quantity: item.quantity, price: variant?.price ?? product.price, discount: product.discount, productName: product.product_name,
      ...(!variant && product.sku ? { sku: product.sku } : {}),
      ...(variant ? { variantId: variant._id, sku: variant.sku, variantName: variant.variant_name, selectedOptions: { ...variant.attributes, ...(variant.color ? { color: variant.color } : {}), ...(variant.size ? { size: variant.size } : {}) } } : {}),
    });
  }
  calculateOrderTotal(orderItems);
  return orderItems;
}
