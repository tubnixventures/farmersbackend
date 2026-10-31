/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveGpsTracking, OrderStatusHistoryEntry } from '../types/index.ts';
import { dbManager } from '../db/mongo.ts';

/**
 * Cloudflare Durable Object: OrderTrackingDurableObject
 *
 * CHEAPEST ROUTE DESIGN:
 * 1. High-frequency GPS pings from couriers/drivers are held strictly in IN-MEMORY instance variables.
 *    This completely avoids thousands of billable DO storage writes per trip.
 * 2. Only status transitions (e.g., 'dispatched' -> 'in_transit' -> 'delivered') trigger
 *    storage persistence and sync to the main order status history.
 * 3. Fast buyer polling queries read instantly from memory with sub-millisecond edge latency.
 */
export class OrderTrackingDurableObject {
  private orderId: string = '';
  private subOrderId: string = '';
  private liveGps: LiveGpsTracking | null = null;
  private currentStatus: string = 'preparing';
  private history: OrderStatusHistoryEntry[] = [];
  private state?: { storage: { get: (key: string) => Promise<any>; put: (key: string, val: any) => Promise<void> } };

  constructor(state?: any, env?: any) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. GET /status: Polled by buyers for live GPS & status history
    if (request.method === 'GET' && (path.endsWith('/status') || path === '/')) {
      return new Response(
        JSON.stringify({
          success: true,
          orderId: this.orderId,
          subOrderId: this.subOrderId,
          status: this.currentStatus,
          liveGps: this.liveGps,
          statusHistory: this.history,
          isLiveTrackingActive: this.currentStatus === 'in_transit' || this.currentStatus === 'dispatched',
          cachedAt: new Date().toISOString(),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        }
      );
    }

    // 2. POST /gps-ping: Courier / Driver sends live GPS (Zero storage write billing)
    if (request.method === 'POST' && path.endsWith('/gps-ping')) {
      const data = (await request.json()) as {
        orderId: string;
        subOrderId?: string;
        lat: number;
        lng: number;
        speedKmh?: number;
        heading?: number;
        courierName?: string;
        courierPhone?: string;
        estimatedArrivalMinutes?: number;
      };

      this.orderId = data.orderId;
      if (data.subOrderId) this.subOrderId = data.subOrderId;

      // In-memory update (cheapest path: zero storage write fees)
      this.liveGps = {
        lat: data.lat,
        lng: data.lng,
        speedKmh: data.speedKmh,
        heading: data.heading,
        lastPingAt: new Date().toISOString(),
        courierName: data.courierName,
        courierPhone: data.courierPhone,
        estimatedArrivalMinutes: data.estimatedArrivalMinutes,
      };

      // Also sync into DB record in-memory for consistency
      const order = dbManager.inMemory.orders.get(this.orderId);
      if (order) {
        const sub = order.vendorOrders.find((s) => !data.subOrderId || s.subOrderId === data.subOrderId);
        if (sub) {
          sub.liveGps = this.liveGps;
        }
      }

      return new Response(JSON.stringify({ success: true, message: 'GPS updated in Durable Object memory' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. POST /status-transition: Major status milestone (persists history)
    if (request.method === 'POST' && path.endsWith('/status-transition')) {
      const data = (await request.json()) as {
        orderId: string;
        subOrderId?: string;
        newStatus: string;
        lat?: number;
        lng?: number;
        locationName?: string;
        note?: string;
        updatedBy: string;
      };

      this.orderId = data.orderId;
      if (data.subOrderId) this.subOrderId = data.subOrderId;
      this.currentStatus = data.newStatus;

      const historyEntry: OrderStatusHistoryEntry = {
        status: data.newStatus,
        timestamp: new Date().toISOString(),
        lat: data.lat || this.liveGps?.lat,
        lng: data.lng || this.liveGps?.lng,
        locationName: data.locationName,
        note: data.note,
        updatedBy: data.updatedBy,
      };

      this.history.push(historyEntry);

      // Only write to durable storage on major milestones
      if (this.state?.storage) {
        await this.state.storage.put('meta', {
          orderId: this.orderId,
          status: this.currentStatus,
          history: this.history,
        });
      }

      // Sync to main database
      const order = dbManager.inMemory.orders.get(this.orderId);
      if (order) {
        order.statusHistory.push(historyEntry);
        if (data.subOrderId) {
          const sub = order.vendorOrders.find((s) => s.subOrderId === data.subOrderId);
          if (sub) {
            sub.status = data.newStatus as any;
            sub.statusHistory.push(historyEntry);
          }
        }
      }

      return new Response(JSON.stringify({ success: true, historyEntry }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }
}

// Global in-process registry of Durable Objects for edge/node emulation
export const doRegistry = new Map<string, OrderTrackingDurableObject>();

export function getOrCreateOrderTracker(orderId: string): OrderTrackingDurableObject {
  let tracker = doRegistry.get(orderId);
  if (!tracker) {
    tracker = new OrderTrackingDurableObject();
    doRegistry.set(orderId, tracker);
  }
  return tracker;
}
