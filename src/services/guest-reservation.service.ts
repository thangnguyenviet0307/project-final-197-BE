import createHttpError from "http-errors";
import { Order } from "../models/orders.model.js";
import { CheckoutRequest } from "../models/checkout-requests.model.js";
import { OrderStatus, type IOrder } from "../types/orders.type.js";
import { withRelationsTransaction } from "../utils/relations-transaction.js";
import { restoreOrderStock } from "./order-reservation.service.js";

export function assertGuestReservationActive(order: Pick<IOrder, "guestCheckout" | "reservationExpiresAt" | "orderStatus" | "userId">) {
  if (order.guestCheckout && order.orderStatus === OrderStatus.Pending && !order.userId &&
      order.reservationExpiresAt && order.reservationExpiresAt <= new Date()) {
    throw createHttpError(409, "Guest reservation has expired; refresh the order list", { businessCode: "CHECKOUT_RESERVATION_EXPIRED" });
  }
}

function expiredScope(now: Date) {
  return { guestCheckout: true, orderStatus: OrderStatus.Pending, userId: null,
    reservationExpiresAt: { $lte: now }, reservationExpiredAt: null };
}

// The relations lock plus conditional transition is the claim: concurrent workers,
// staff acceptance and rejection cannot restore the same reservation twice.
export async function expireGuestReservation(id: string, now = new Date()): Promise<boolean> {
  return withRelationsTransaction(async session => {
    const order = await Order.findOneAndUpdate({ _id: id, ...expiredScope(now) }, {
      $set: { orderStatus: OrderStatus.Rejected, reservationExpiredAt: now,
        cancellationReason: "Hết thời hạn chờ cửa hàng xác nhận đơn vãng lai (24 giờ)." },
    }, { returnDocument: "after", session, runValidators: true });
    if (!order) return false;
    if (!order.checkoutRequestId) throw createHttpError(409, "Reservation request missing; review before expiration");
    await restoreOrderStock(order.orderItems, session);
    const receipt = await CheckoutRequest.updateOne({ customerId: null, requestId: order.checkoutRequestId },
      { $set: { reservationExpiredAt: now } }, { session });
    if (receipt.matchedCount !== 1) throw createHttpError(409, "Reservation receipt missing; review before expiration");
    return true;
  });
}

export async function processGuestReservationBatch() {
  const now = new Date();
  const orders = await Order.find({ ...expiredScope(now), $or: [{ reservationRetryAt: null }, { reservationRetryAt: { $lte: now } }] })
    .select("_id").sort({ reservationExpiresAt: 1, _id: 1 }).limit(20).lean();
  for (const order of orders) {
    try { await expireGuestReservation(order._id.toString(), now); }
    catch {
      console.error("Guest reservation expiration failed; manual review may be required", { orderId: order._id.toString() });
      // Back off broken reservations so they cannot starve the next batch.
      await Order.updateOne({ _id: order._id, ...expiredScope(now) }, { $set: { reservationRetryAt: new Date(now.getTime() + 5 * 60_000) } });
    }
  }
}

export function startGuestReservationWorker() {
  let active: Promise<void> | null = null;
  const tick = () => {
    if (active) return;
    active = processGuestReservationBatch().catch(() => {
      console.error("Guest reservation queue unavailable; will retry");
    }).finally(() => { active = null; });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => { clearInterval(timer); await active; };
}
