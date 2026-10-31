/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import type { Order, VendorSubOrder, Product, GeoLocation, User, OrderStatusHistoryEntry, OrderRating } from '../types/index.ts';
import { calculateHaversineDistanceKm, calculateDeliveryFee, findClosestAlternativeSeller } from './geo.service.ts';
import { walletService } from './wallet.service.ts';
import { commsService } from './communication.service.ts';
import { getOrCreateOrderTracker } from '../durable-objects/order-tracker.do.ts';

export class OrderService {
  /**
   * Creates order in 'draft' status.
   * CRITICAL REQUIREMENT: An order is draft until paid for.
   * Sellers are NOT notified until payment is confirmed via gateway webhook!
   */
  async createOrder(data: {
    buyerId: string;
    items: { productId: string; quantity: number }[];
    deliveryAddress: string;
    buyerLocation: GeoLocation;
    buyerUrgencyNotes?: string;
    preferSingleSeller?: boolean;
    paymentGateway: 'paystack' | 'pawapay';
  }): Promise<Order> {
    const mem = dbManager.inMemory;
    const buyer = mem.users.get(data.buyerId);
    if (!buyer) throw new Error('Buyer account not found');

    if (!data.items || data.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    // 1. ATOMIC STOCK VALIDATION: Verify every product exists and has sufficient stock.
    // Strictly prevents balance 3 -> ordering 50 overbuy attempt!
    const productMap = new Map<string, Product>();
    for (const item of data.items) {
      if (item.quantity <= 0) {
        throw new Error(`Invalid quantity ${item.quantity} for product ID ${item.productId}`);
      }
      const prod = mem.products.get(item.productId);
      if (!prod) {
        throw new Error(`Product not found: ${item.productId}`);
      }
      if (!prod.isAvailable) {
        throw new Error(`Product "${prod.title}" is currently marked unavailable by seller.`);
      }
      if (prod.stockQuantity < item.quantity) {
        throw new Error(
          `Insufficient inventory for "${prod.title}". Requested: ${item.quantity} ${prod.unit}, but only ${prod.stockQuantity} ${prod.unit} available in stock.`
        );
      }
      productMap.set(item.productId, prod);
    }

    // 2. ATOMIC INVENTORY DECREMENT (Prevents race-condition overbuying)
    for (const item of data.items) {
      const prod = productMap.get(item.productId)!;
      prod.stockQuantity -= item.quantity;
      prod.updatedAt = new Date().toISOString();
    }

    // 3. MULTI-VENDOR SPLITTING: Group items by sellerId
    const vendorBuckets = new Map<
      string,
      {
        vendor: User;
        items: {
          productId: string;
          title: string;
          quantity: number;
          unitPrice: number;
          subtotal: number;
          unit: string;
          acceptanceTimeoutMinutes: number;
        }[];
      }
    >();

    for (const item of data.items) {
      const prod = productMap.get(item.productId)!;
      const seller = mem.users.get(prod.sellerId);
      if (!seller) {
        throw new Error(`Seller account #${prod.sellerId} not found`);
      }

      if (!vendorBuckets.has(prod.sellerId)) {
        vendorBuckets.set(prod.sellerId, { vendor: seller, items: [] });
      }

      vendorBuckets.get(prod.sellerId)!.items.push({
        productId: prod.id,
        title: prod.title,
        quantity: item.quantity,
        unitPrice: prod.pricePerUnit,
        subtotal: prod.pricePerUnit * item.quantity,
        unit: prod.unit,
        acceptanceTimeoutMinutes: prod.acceptanceTimeoutMinutes || 30,
      });
    }

    // 4. Build Vendor Sub-Orders initialized in 'draft' status
    const orderId = `ord_${crypto.randomBytes(8).toString('hex')}`;
    const vendorOrders: VendorSubOrder[] = [];
    let calculatedItemsTotal = 0;
    let totalDeliveryFee = 0;
    const now = new Date().toISOString();

    for (const [vendorId, bucket] of vendorBuckets.entries()) {
      const subOrderId = `sub_${crypto.randomBytes(6).toString('hex')}`;
      const subtotal = bucket.items.reduce((sum, it) => sum + it.subtotal, 0);
      calculatedItemsTotal += subtotal;

      // Distance & delivery fee calculation
      const dist = calculateHaversineDistanceKm(
        data.buyerLocation.lat,
        data.buyerLocation.lng,
        bucket.vendor.location.lat,
        bucket.vendor.location.lng
      );
      totalDeliveryFee += calculateDeliveryFee(dist);

      const subOrder: VendorSubOrder = {
        subOrderId,
        vendorId,
        vendorRole: bucket.vendor.role === 'agrovet' ? 'agrovet' : 'farmer',
        vendorLocation: bucket.vendor.location,
        items: bucket.items.map((it) => ({
          productId: it.productId,
          title: it.title,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          unit: it.unit,
        })),
        subtotal,
        status: 'draft', // DRAFT UNTIL PAID
        statusHistory: [
          {
            status: 'draft',
            timestamp: now,
            locationName: bucket.vendor.location.county,
            note: 'Sub-order created in draft state awaiting payment verification.',
            updatedBy: 'system',
          },
        ],
        acceptanceExpiresAt: now, // Will be set upon payment confirmation
        rerouteHistory: [],
      };

      vendorOrders.push(subOrder);
    }

    // 6-digit delivery secret PIN code for proof of receipt
    const deliveryAckCode = Math.floor(100000 + Math.random() * 900000).toString();

    const order: Order = {
      id: orderId,
      buyerId: data.buyerId,
      buyerLocation: data.buyerLocation,
      deliveryAddress: data.deliveryAddress,
      buyerUrgencyNotes: data.buyerUrgencyNotes,
      vendorOrders,
      totalAmount: calculatedItemsTotal,
      deliveryFee: totalDeliveryFee,
      grandTotal: calculatedItemsTotal + totalDeliveryFee,
      paymentGateway: data.paymentGateway,
      status: 'draft', // DRAFT: Seller NOT notified yet
      paymentStatus: 'draft',
      escrowStatus: 'unfunded',
      statusHistory: [
        {
          status: 'draft',
          timestamp: now,
          lat: data.buyerLocation.lat,
          lng: data.buyerLocation.lng,
          locationName: data.buyerLocation.county,
          note: 'Order drafted. Pending mobile money / card payment.',
          updatedBy: 'buyer',
        },
      ],
      deliveryAckCode,
      isSingleVendorOrder: vendorOrders.length === 1,
      createdAt: now,
      updatedAt: now,
    };

    mem.orders.set(order.id, order);

    // Initialize Durable Object tracker for live shipping
    const tracker = getOrCreateOrderTracker(order.id);
    await tracker.fetch(
      new Request('http://internal/status-transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          newStatus: 'draft',
          lat: data.buyerLocation.lat,
          lng: data.buyerLocation.lng,
          locationName: data.buyerLocation.county,
          note: 'Order placed in draft state',
          updatedBy: 'system',
        }),
      })
    );

    // NOTICE: We deliberately DO NOT alert vendors here.
    // Sellers are ONLY alerted once payment webhook marks order as paid!
    return order;
  }

  /**
   * Called by PawaPay or Paystack webhook once payment succeeds:
   * 1. Transitions order from 'draft' to 'paid'.
   * 2. Locks funds into seller's escrow wallet balance.
   * 3. Sets dynamic acceptance timers per category.
   * 4. NOTIFIES SELLERS & BUYER via Infobip WhatsApp!
   */
  async markOrderPaid(
    orderId: string,
    gateway: 'paystack' | 'pawapay',
    paymentReference: string
  ): Promise<Order> {
    const mem = dbManager.inMemory;
    const order = mem.orders.get(orderId);
    if (!order) throw new Error(`Order #${orderId} not found`);

    if (order.paymentStatus === 'paid') {
      return order; // idempotent
    }

    const now = new Date();
    order.status = 'paid';
    order.paymentStatus = 'paid';
    order.escrowStatus = 'locked';
    order.paymentReference = paymentReference;
    order.updatedAt = now.toISOString();

    const historyEntry: OrderStatusHistoryEntry = {
      status: 'paid',
      timestamp: now.toISOString(),
      note: `Payment confirmed via ${gateway.toUpperCase()} (Ref: ${paymentReference}). Funds held in Escrow.`,
      updatedBy: 'gateway',
    };
    order.statusHistory.push(historyEntry);

    const buyer = mem.users.get(order.buyerId);

    // Update sub-orders, lock escrow, and alert sellers
    for (const sub of order.vendorOrders) {
      sub.status = 'pending_acceptance';
      sub.statusHistory.push(historyEntry);

      // Determine dynamic category acceptance timeout (e.g. 30m for vegetables)
      const primaryItem = sub.items[0];
      const prod = mem.products.get(primaryItem?.productId);
      const timeoutMins = prod?.acceptanceTimeoutMinutes || 30;
      sub.acceptanceExpiresAt = new Date(now.getTime() + timeoutMins * 60 * 1000).toISOString();

      // Lock funds in escrow (ONLY FUND SELLER ONCE DELIVERED)
      await walletService.lockEscrowFunds(sub.vendorId, sub.subtotal, order.id, sub.subOrderId);

      // Notify Vendor via WhatsApp NOW that order is funded and secured
      const vendorUser = mem.users.get(sub.vendorId);
      if (vendorUser && buyer) {
        await commsService.notifyOrderParties({
          buyerPhone: buyer.phone,
          buyerName: buyer.fullName,
          vendorPhone: vendorUser.phone,
          vendorName: vendorUser.fullName,
          vendorRole: sub.vendorRole,
          orderId: order.id,
          totalAmountKES: sub.subtotal,
          subOrderId: sub.subOrderId,
          ackCode: order.deliveryAckCode,
        });
      }
    }

    // Update Durable Object tracker
    const tracker = getOrCreateOrderTracker(order.id);
    await tracker.fetch(
      new Request('http://internal/status-transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          newStatus: 'paid',
          note: `Payment confirmed. Escrow secured.`,
          updatedBy: 'gateway',
        }),
      })
    );

    return order;
  }

  /**
   * Farmer/Agrovet accepts incoming order
   */
  async acceptSubOrder(vendorId: string, subOrderId: string): Promise<VendorSubOrder> {
    const { order, subOrder } = this.findSubOrder(subOrderId);

    if (subOrder.vendorId !== vendorId) {
      throw new Error('Unauthorized: You are not the assigned vendor for this sub-order.');
    }

    if (subOrder.status === 'draft') {
      throw new Error('Order is still in draft state awaiting buyer payment confirmation.');
    }

    if (subOrder.status !== 'pending_acceptance') {
      throw new Error(`Sub-order cannot be accepted in current state: ${subOrder.status}`);
    }

    if (new Date(subOrder.acceptanceExpiresAt).getTime() < Date.now()) {
      await this.autoRerouteSubOrder(subOrderId, 'Acceptance window expired before vendor confirmation');
      throw new Error('Acceptance window expired. Order has been automatically rerouted to nearest qualified farmer.');
    }

    const now = new Date().toISOString();
    subOrder.status = 'accepted';
    subOrder.acceptedAt = now;

    const historyEntry: OrderStatusHistoryEntry = {
      status: 'accepted',
      timestamp: now,
      note: 'Farmer accepted order. Commodity harvest and packing commenced.',
      updatedBy: 'farmer',
    };
    subOrder.statusHistory.push(historyEntry);
    order.statusHistory.push(historyEntry);
    order.updatedAt = now;

    return subOrder;
  }

  /**
   * Farmer/Agrovet declines sub-order: triggers immediate auto-routing to next closest seller
   */
  async declineSubOrder(vendorId: string, subOrderId: string, reason: string): Promise<{ rerouted: boolean; message: string }> {
    const { subOrder } = this.findSubOrder(subOrderId);

    if (subOrder.vendorId !== vendorId) throw new Error('Unauthorized');

    subOrder.status = 'declined';
    subOrder.declinedAt = new Date().toISOString();
    subOrder.declineReason = reason;

    const rerouteSuccess = await this.autoRerouteSubOrder(subOrderId, `Seller declined: ${reason}`);

    return {
      rerouted: rerouteSuccess,
      message: rerouteSuccess
        ? 'Order successfully rerouted to next nearest qualified producer.'
        : 'No alternative seller within delivery threshold; funds refunded to buyer.',
    };
  }

  /**
   * Automated Routing Engine
   */
  async autoRerouteSubOrder(subOrderId: string, reason: string): Promise<boolean> {
    const { order, subOrder } = this.findSubOrder(subOrderId);
    const mem = dbManager.inMemory;

    const excludedVendors = [subOrder.vendorId, ...subOrder.rerouteHistory.map((h) => h.fromVendorId)];
    const primaryItem = subOrder.items[0];
    const originalProd = mem.products.get(primaryItem.productId);

    if (!originalProd) return false;

    const allProducts = Array.from(mem.products.values());
    const candidateMatch = findClosestAlternativeSeller(
      allProducts,
      originalProd,
      primaryItem.quantity,
      order.buyerLocation,
      excludedVendors
    );

    if (!candidateMatch) {
      subOrder.status = 'cancelled';
      order.updatedAt = new Date().toISOString();
      originalProd.stockQuantity += primaryItem.quantity;
      return false;
    }

    const newProduct = candidateMatch.product;
    const newVendor = mem.users.get(newProduct.sellerId);
    if (!newVendor) return false;

    newProduct.stockQuantity -= primaryItem.quantity;
    originalProd.stockQuantity += primaryItem.quantity;

    subOrder.rerouteHistory.push({
      fromVendorId: subOrder.vendorId,
      toVendorId: newProduct.sellerId,
      reason,
      timestamp: new Date().toISOString(),
    });

    subOrder.vendorId = newProduct.sellerId;
    subOrder.vendorRole = newVendor.role === 'agrovet' ? 'agrovet' : 'farmer';
    subOrder.vendorLocation = newVendor.location;
    subOrder.status = 'pending_acceptance';
    subOrder.acceptanceExpiresAt = new Date(Date.now() + (newProduct.acceptanceTimeoutMinutes || 30) * 60 * 1000).toISOString();

    const historyEntry: OrderStatusHistoryEntry = {
      status: 'rerouted',
      timestamp: new Date().toISOString(),
      note: `Auto-rerouted to nearest producer: ${newVendor.fullName} (${candidateMatch.distanceKm} km away). Reason: ${reason}`,
      updatedBy: 'system',
    };
    subOrder.statusHistory.push(historyEntry);

    await commsService.sendInfobipWhatsApp({
      recipientPhone: newVendor.phone,
      recipientRole: subOrder.vendorRole,
      message: `Habari ${newVendor.fullName}! A new rerouted order (#${subOrder.subOrderId}) for ${primaryItem.quantity} ${primaryItem.unit} of ${newProduct.title} has been assigned to your farm. Please accept promptly.`,
    });

    return true;
  }

  /**
   * Dispatches sub-order for transport
   */
  async markDispatched(
    vendorId: string,
    subOrderId: string,
    courierInfo?: { name?: string; phone?: string; initialLat?: number; initialLng?: number }
  ): Promise<VendorSubOrder> {
    const { order, subOrder } = this.findSubOrder(subOrderId);
    if (subOrder.vendorId !== vendorId) throw new Error('Unauthorized');

    const now = new Date().toISOString();
    subOrder.status = 'dispatched';
    subOrder.dispatchedAt = now;

    if (courierInfo?.initialLat && courierInfo?.initialLng) {
      subOrder.liveGps = {
        lat: courierInfo.initialLat,
        lng: courierInfo.initialLng,
        courierName: courierInfo.name || 'Local Rider / Transporter',
        courierPhone: courierInfo.phone,
        lastPingAt: now,
      };
    }

    const historyEntry: OrderStatusHistoryEntry = {
      status: 'dispatched',
      timestamp: now,
      lat: courierInfo?.initialLat,
      lng: courierInfo?.initialLng,
      note: `Produce dispatched for transport with ${courierInfo?.name || 'Local Agro-Courier'}.`,
      updatedBy: 'farmer',
    };
    subOrder.statusHistory.push(historyEntry);
    order.statusHistory.push(historyEntry);
    order.status = 'dispatched';

    // Update Durable Object tracker
    const tracker = getOrCreateOrderTracker(order.id);
    await tracker.fetch(
      new Request('http://internal/status-transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          subOrderId,
          newStatus: 'dispatched',
          lat: courierInfo?.initialLat,
          lng: courierInfo?.initialLng,
          note: historyEntry.note,
          updatedBy: 'farmer',
        }),
      })
    );

    return subOrder;
  }

  /**
   * Confirms delivery acknowledgement PIN code:
   * STRICT INTEGRITY: Only funds seller ONCE DELIVERED!
   */
  async confirmDeliveryAcknowledgement(
    buyerId: string,
    subOrderId: string,
    submittedCode: string
  ): Promise<{ success: boolean; subOrder: VendorSubOrder; releasedBalanceKES: number }> {
    const { order, subOrder } = this.findSubOrder(subOrderId);

    if (order.buyerId !== buyerId) {
      throw new Error('Unauthorized: You are not the buyer for this order.');
    }

    if (order.deliveryAckCode !== submittedCode) {
      throw new Error('Invalid delivery acknowledgement code. Please check your order details or SMS/WhatsApp.');
    }

    if (subOrder.status === 'delivered') {
      throw new Error('This sub-order has already been marked delivered and funds released.');
    }

    const now = new Date().toISOString();
    subOrder.status = 'delivered';
    subOrder.deliveredAt = now;

    const historyEntry: OrderStatusHistoryEntry = {
      status: 'delivered',
      timestamp: now,
      note: 'Delivery acknowledged by buyer PIN entry. Escrow unlocked and funds credited to seller.',
      updatedBy: 'buyer',
    };
    subOrder.statusHistory.push(historyEntry);
    order.statusHistory.push(historyEntry);

    // Platform commission (5% for agrovet, 2% for farmers)
    const commissionPercent = subOrder.vendorRole === 'agrovet' ? 5.0 : 2.0;

    // Release escrow funds into seller's available balance!
    const { releasedTx } = await walletService.releaseEscrowFunds(
      subOrder.vendorId,
      subOrder.subtotal,
      commissionPercent,
      order.id,
      subOrder.subOrderId
    );

    const allDelivered = order.vendorOrders.every((s) => s.status === 'delivered');
    if (allDelivered) {
      order.status = 'delivered';
      order.escrowStatus = 'fully_released';
    } else {
      order.escrowStatus = 'partially_released';
    }
    order.updatedAt = now;

    // Update Durable Object tracker
    const tracker = getOrCreateOrderTracker(order.id);
    await tracker.fetch(
      new Request('http://internal/status-transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          subOrderId,
          newStatus: 'delivered',
          note: historyEntry.note,
          updatedBy: 'buyer',
        }),
      })
    );

    return {
      success: true,
      subOrder,
      releasedBalanceKES: releasedTx.netAmount,
    };
  }

  /**
   * Submit Buyer Rating for Delivered Sub-Order
   */
  async submitRating(data: {
    buyerId: string;
    subOrderId: string;
    rating: number;
    comment: string;
    freshnessScore?: number;
    deliveryScore?: number;
    packagingScore?: number;
  }): Promise<OrderRating> {
    const { order, subOrder } = this.findSubOrder(data.subOrderId);

    if (order.buyerId !== data.buyerId) {
      throw new Error('Unauthorized: Only the buyer can rate this order.');
    }

    if (subOrder.status !== 'delivered') {
      throw new Error('You can only rate an order after delivery is completed and acknowledged.');
    }

    const mem = dbManager.inMemory;
    const buyer = mem.users.get(data.buyerId);
    const ratingId = `rat_${crypto.randomBytes(6).toString('hex')}`;

    const rating: OrderRating = {
      id: ratingId,
      orderId: order.id,
      subOrderId: subOrder.subOrderId,
      buyerId: data.buyerId,
      buyerName: buyer?.fullName || 'Verified Buyer',
      vendorId: subOrder.vendorId,
      rating: data.rating,
      comment: data.comment,
      freshnessScore: data.freshnessScore,
      deliveryScore: data.deliveryScore,
      packagingScore: data.packagingScore,
      createdAt: new Date().toISOString(),
    };

    mem.ratings.set(rating.id, rating);
    return rating;
  }

  private findSubOrder(subOrderId: string): { order: Order; subOrder: VendorSubOrder } {
    const mem = dbManager.inMemory;
    for (const order of mem.orders.values()) {
      const sub = order.vendorOrders.find((s) => s.subOrderId === subOrderId);
      if (sub) {
        return { order, subOrder: sub };
      }
    }
    throw new Error(`Sub-order not found: ${subOrderId}`);
  }
}

export const orderService = new OrderService();
