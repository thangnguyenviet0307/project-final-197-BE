import createHttpError from "http-errors";
import type { IOrderItem } from "../types/orders.type.js";

function fraction(value: number): [bigint, bigint] {
  if (!Number.isFinite(value) || value < 0) throw createHttpError(400, "Invalid monetary value");
  const [mantissa = "0", exponent = "0"] = value.toString().toLowerCase().split("e");
  const [integer = "0", decimals = ""] = mantissa.split(".");
  const scale = decimals.length - Number(exponent);
  const numerator = BigInt(integer + decimals);
  return scale >= 0 ? [numerator, 10n ** BigInt(scale)] : [numerator * 10n ** BigInt(-scale), 1n];
}

// Round each discounted line to two decimal places, half up, using integer arithmetic.
export function calculateOrderTotal(items: Pick<IOrderItem, "price" | "discount" | "quantity">[]): number {
  let cents = 0n;
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.discount > 70) throw createHttpError(400, "Invalid order item");
    const [price, priceScale] = fraction(item.price);
    const [discount, discountScale] = fraction(item.discount);
    const numerator = BigInt(item.quantity) * price * (100n * discountScale - discount);
    const denominator = priceScale * discountScale;
    cents += (2n * numerator + denominator) / (2n * denominator);
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw createHttpError(400, "Order total is too large");
  return Number(cents) / 100;
}
