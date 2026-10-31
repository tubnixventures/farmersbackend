/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { dbManager } from '../db/mongo.ts';
import { orderService } from '../services/order.service.ts';
import { receiptService } from '../services/receipt.service.ts';
import { getOrCreateOrderTracker } from '../durable-objects/order-tracker.do.ts';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.ts';
import {
  checkoutSchema,
  directOrderSchema,
  declineSubOrderSchema,
  dispatchSubOrderSchema,
  gpsPingSchema,
  orderRatingSchema,
  deliveryAckSchema,
} from '../validators/schemas.ts';
import type { User, Order } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const orderApp = new Hono<AppEnv>();

/**
 * Checkout cart: Creates order in DRAFT status
 * Sellers are NOT notified until payment is confirmed!
 */
orderApp.post('/checkout', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = checkoutSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const cart = mem.carts.get(user.id);
  if (!cart || cart.items.length === 0) {
    return c.json({ success: false, error: 'Your cart is empty' }, 400);
  }

  try {
    const order = await orderService.createOrder({
      buyerId: user.id,
      items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      deliveryAddress: parsed.data.deliveryAddress,
      buyerLocation: parsed.data.buyerLocation,
      buyerUrgencyNotes: parsed.data.buyerUrgencyNotes,
      preferSingleSeller: parsed.data.preferSingleSeller,
      paymentGateway: parsed.data.paymentGateway,
    });

    mem.carts.delete(user.id);

    return c.json(
      {
        success: true,
        message: 'Order created in DRAFT status. Please complete payment to notify seller and secure escrow.',
        order,
      },
      201
    );
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Direct purchase endpoint (bypassing cart): Creates order in DRAFT status
 */
orderApp.post('/direct', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = directOrderSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  try {
    const order = await orderService.createOrder({
      buyerId: user.id,
      items: parsed.data.items,
      deliveryAddress: parsed.data.deliveryAddress,
      buyerLocation: parsed.data.buyerLocation,
      buyerUrgencyNotes: parsed.data.buyerUrgencyNotes,
      preferSingleSeller: parsed.data.preferSingleSeller,
      paymentGateway: parsed.data.paymentGateway,
    });

    return c.json(
      {
        success: true,
        message: 'Direct order placed in DRAFT status. Seller will be notified once payment is confirmed.',
        order,
      },
      201
    );
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * List orders
 */
orderApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const mem = dbManager.inMemory;
  const allOrders = Array.from(mem.orders.values());

  if (user.role === 'admin') {
    return c.json({ success: true, count: allOrders.length, orders: allOrders });
  }

  if (user.role === 'buyer') {
    const buyerOrders = allOrders.filter((o) => o.buyerId === user.id);
    return c.json({ success: true, count: buyerOrders.length, orders: buyerOrders });
  }

  // Farmer or Agrovet: Return orders that contain sub-orders for this vendor
  // Only show orders that are PAID or beyond (exclude draft orders not yet paid for!)
  const vendorOrders = allOrders
    .filter((o) => o.status !== 'draft')
    .map((o) => {
      const mySubOrders = o.vendorOrders.filter((sub) => sub.vendorId === user.id && sub.status !== 'draft');
      if (mySubOrders.length === 0) return null;
      return {
        orderId: o.id,
        buyerId: o.buyerId,
        buyerLocation: o.buyerLocation,
        deliveryAddress: o.deliveryAddress,
        buyerUrgencyNotes: o.buyerUrgencyNotes,
        subOrders: mySubOrders,
        createdAt: o.createdAt,
      };
    })
    .filter(Boolean);

  return c.json({ success: true, count: vendorOrders.length, orders: vendorOrders });
});

/**
 * Get specific order details
 */
orderApp.get('/:id', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const orderId = c.req.param('id')!;
  const order = dbManager.inMemory.orders.get(orderId);

  if (!order) return c.json({ success: false, error: 'Order not found' }, 404);

  const isBuyer = order.buyerId === user.id;
  const isVendor = order.vendorOrders.some((s) => s.vendorId === user.id);
  const isAdmin = user.role === 'admin';

  if (!isBuyer && !isVendor && !isAdmin) {
    return c.json({ success: false, error: 'Unauthorized to view this order' }, 403);
  }

  const sanitizedOrder = {
    ...order,
    deliveryAckCode: isBuyer || isAdmin ? order.deliveryAckCode : '******',
  };

  return c.json({ success: true, order: sanitizedOrder });
});

/**
 * LIVE GPS & SHIPPING STATUS POLLING ENDPOINT (Cloudflare Durable Object)
 * Powered by OrderTrackingDurableObject:
 * Delivers real-time GPS coordinates and order status history with sub-millisecond edge latency
 * using cheapest route (in-memory polling without persistent DB write bloat).
 */
orderApp.get('/:id/tracking', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const orderId = c.req.param('id')!;
  const mem = dbManager.inMemory;
  const order = mem.orders.get(orderId);

  if (!order) return c.json({ success: false, error: 'Order not found' }, 404);

  const isBuyer = order.buyerId === user.id;
  const isVendor = order.vendorOrders.some((s) => s.vendorId === user.id);
  const isAdmin = user.role === 'admin';

  if (!isBuyer && !isVendor && !isAdmin) {
    return c.json({ success: false, error: 'Unauthorized' }, 403);
  }

  // Poll directly from the Durable Object
  const tracker = getOrCreateOrderTracker(orderId);
  const doResponse = await tracker.fetch(new Request('http://internal/status'));
  const trackingData = await doResponse.json();

  return c.json({
    success: true,
    orderId,
    tracking: trackingData,
    dbStatusHistory: order.statusHistory,
    currentOrderStatus: order.status,
    escrowStatus: order.escrowStatus,
  });
});

/**
 * COURIER / DRIVER LIVE GPS PING (Cloudflare Durable Object In-Memory Ingestion)
 * Zero DO storage write costs: stores live coordinates in Durable Object memory.
 */
orderApp.post('/:id/tracking/gps-ping', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const orderId = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = gpsPingSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const tracker = getOrCreateOrderTracker(orderId);
  const doResponse = await tracker.fetch(
    new Request('http://internal/gps-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        speedKmh: parsed.data.speedKmh,
        heading: parsed.data.heading,
        courierName: parsed.data.courierName || user.fullName,
        courierPhone: parsed.data.courierPhone || user.phone,
        estimatedArrivalMinutes: parsed.data.estimatedArrivalMinutes,
      }),
    })
  );

  const result = await doResponse.json();
  return c.json(result);
});

/**
 * RECEIPT FEATURE: Generate on-the-fly digital receipt with scannable QR Code
 * STRICT ZERO-R2 STORAGE: Generated dynamically from server database records.
 */
orderApp.get('/:id/receipt', authMiddleware, async (c) => {
  const orderId = c.req.param('id')!;
  const subOrderId = c.req.query('subOrderId');

  try {
    const receipt = await receiptService.generateReceipt(orderId, subOrderId);
    return c.json({
      success: true,
      message: 'Receipt generated on the fly. Scannable via QR code. Zero files stored in R2.',
      receipt,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * RECEIPT FEATURE: Dispatch receipt via Infobip WhatsApp
 */
orderApp.post('/:id/receipt/send-whatsapp', authMiddleware, async (c) => {
  const orderId = c.req.param('id')!;
  const subOrderId = c.req.query('subOrderId');
  const { recipientType } = (await c.req.json().catch(() => ({}))) as { recipientType?: 'buyer' | 'farmer' | 'both' };

  try {
    const receipt = await receiptService.generateReceipt(orderId, subOrderId);
    const result = await receiptService.sendReceiptViaWhatsApp(receipt, recipientType || 'both');
    return c.json(result);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * PUBLIC RECEIPT QR CODE SCAN VERIFICATION ENDPOINT
 * Anyone scanning the QR code on a physical/digital receipt can verify authenticity
 */
orderApp.get('/receipts/verify/:receiptNumber', async (c) => {
  const receiptNumber = c.req.param('receiptNumber')!;
  const mem = dbManager.inMemory;

  // Search across orders
  for (const order of mem.orders.values()) {
    const year = new Date(order.createdAt).getFullYear();
    const orderPrefix = `RCP-${year}-${order.id.slice(-6).toUpperCase()}`;

    if (receiptNumber.startsWith(orderPrefix)) {
      const buyer = mem.users.get(order.buyerId);
      return c.json({
        verified: true,
        receiptNumber,
        orderId: order.id,
        buyerName: buyer?.fullName ? `${buyer.fullName[0]}***` : 'Verified Buyer',
        totalAmountKES: order.grandTotal,
        paymentStatus: order.paymentStatus,
        escrowStatus: order.escrowStatus,
        orderDate: order.createdAt,
        verifiedAt: new Date().toISOString(),
        issuer: 'FarmersWorld Kenya Escrow Settlement',
      });
    }
  }

  return c.json({ verified: false, error: 'Invalid or fraudulent receipt number.' }, 404);
});

/**
 * RATING FEATURE: Buyer rates and reviews delivered sub-order
 */
orderApp.post('/sub-orders/:subOrderId/rate', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const subOrderId = c.req.param('subOrderId')!;
  const body = await c.req.json();
  const parsed = orderRatingSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  try {
    const rating = await orderService.submitRating({
      buyerId: user.id,
      subOrderId,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      freshnessScore: parsed.data.freshnessScore,
      deliveryScore: parsed.data.deliveryScore,
      packagingScore: parsed.data.packagingScore,
    });

    return c.json({
      success: true,
      message: 'Thank you! Your rating and review have been submitted.',
      rating,
    }, 201);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * RATING FEATURE: Get ratings and reviews for a vendor
 */
orderApp.get('/vendors/:vendorId/ratings', async (c) => {
  const vendorId = c.req.param('vendorId')!;
  const mem = dbManager.inMemory;
  const ratings = Array.from(mem.ratings.values()).filter((r) => r.vendorId === vendorId);

  const averageRating =
    ratings.length === 0
      ? 5.0
      : Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length) * 10) / 10;

  return c.json({
    success: true,
    vendorId,
    totalReviews: ratings.length,
    averageRating,
    reviews: ratings.reverse(),
  });
});

/**
 * Vendor: Accept sub-order within dynamic acceptance timeout window
 */
orderApp.post('/sub-orders/:subOrderId/accept', authMiddleware, requireRole('farmer', 'agrovet'), async (c) => {
  const user = c.get('user') as User;
  const subOrderId = c.req.param('subOrderId')!;

  try {
    const updatedSubOrder = await orderService.acceptSubOrder(user.id, subOrderId);
    return c.json({
      success: true,
      message: 'Sub-order accepted successfully. Prepare produce for pickup/delivery.',
      subOrder: updatedSubOrder,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Vendor: Decline sub-order (triggers immediate auto-routing to next closest seller)
 */
orderApp.post('/sub-orders/:subOrderId/decline', authMiddleware, requireRole('farmer', 'agrovet'), async (c) => {
  const user = c.get('user') as User;
  const subOrderId = c.req.param('subOrderId')!;
  const body = await c.req.json();
  const parsed = declineSubOrderSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  try {
    const result = await orderService.declineSubOrder(user.id, subOrderId, parsed.data.reason);
    return c.json({ success: true, ...result });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Vendor: Mark sub-order dispatched for delivery with courier info
 */
orderApp.post('/sub-orders/:subOrderId/dispatch', authMiddleware, requireRole('farmer', 'agrovet'), async (c) => {
  const user = c.get('user') as User;
  const subOrderId = c.req.param('subOrderId')!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = dispatchSubOrderSchema.safeParse(body);

  try {
    const subOrder = await orderService.markDispatched(user.id, subOrderId, {
      name: parsed.success ? parsed.data.courierName : undefined,
      phone: parsed.success ? parsed.data.courierPhone : undefined,
      initialLat: parsed.success ? parsed.data.initialLat : undefined,
      initialLng: parsed.success ? parsed.data.initialLng : undefined,
    });
    return c.json({ success: true, message: 'Sub-order marked dispatched for delivery.', subOrder });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Buyer: Acknowledge delivery with 6-digit PIN:
 * STRICT ESCROW RELEASE: Only funds seller ONCE DELIVERED!
 */
orderApp.post('/sub-orders/:subOrderId/acknowledge-delivery', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const subOrderId = c.req.param('subOrderId')!;
  const body = await c.req.json();
  const parsed = deliveryAckSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  try {
    const result = await orderService.confirmDeliveryAcknowledgement(user.id, subOrderId, parsed.data.code);
    return c.json({
      success: true,
      message: `Delivery acknowledged! KES ${result.releasedBalanceKES.toLocaleString()} released from escrow into vendor's available balance.`,
      subOrder: result.subOrder,
      releasedBalanceKES: result.releasedBalanceKES,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Auto-reroute endpoint (can be called by scheduler or admin)
 */
orderApp.post('/sub-orders/:subOrderId/auto-reroute', authMiddleware, requireRole('admin'), async (c) => {
  const subOrderId = c.req.param('subOrderId')!;
  const { reason } = await c.req.json();

  const success = await orderService.autoRerouteSubOrder(subOrderId, reason || 'Manual admin / scheduler trigger');
  return c.json({ success, message: success ? 'Rerouted successfully' : 'Could not find eligible seller' });
});

export default orderApp;
