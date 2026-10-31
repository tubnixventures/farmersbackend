/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, seedInitialPlatformData } from './backend/app.ts';
import { dbManager } from './backend/db/mongo.ts';
import { orderService } from './backend/services/order.service.ts';
export { OrderTrackingDurableObject } from './backend/durable-objects/order-tracker.do.ts';

// Cloudflare Workers execution environment bindings
export interface Env {
  MEDIA_BUCKET?: unknown;
  MARKETPLACE_ANALYTICS?: unknown;
  AI?: unknown;
  MONGODB_URI?: string;
  JWT_SECRET?: string;
  CRON_SECRET?: string;
}

// Initial boot
seedInitialPlatformData();
dbManager.init();

export default {
  /**
   * Cloudflare Workers HTTP Entrypoint
   */
  fetch(request: Request, env: Env, ctx: unknown): Response | Promise<Response> {
    return app.fetch(request, env as any, ctx as any);
  },

  /**
   * Cloudflare Workers Cron Trigger Scheduler Entrypoint:
   * Periodically triggered to auto-reroute expired perishable orders & reconcile payouts
   */
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env, ctx: unknown): Promise<void> {
    console.log(`[Cloudflare Scheduler] Triggered cron "${event.cron}" at ${new Date(event.scheduledTime).toISOString()}`);

    try {
      // 1. Check for expired perishable orders and auto-reroute to closest farmers
      const mem = dbManager.inMemory;
      const now = Date.now();

      for (const order of mem.orders.values()) {
        for (const sub of order.vendorOrders) {
          if (sub.status === 'pending_acceptance' && new Date(sub.acceptanceExpiresAt).getTime() < now) {
            await orderService.autoRerouteSubOrder(
              sub.subOrderId,
              'Cloudflare Worker cron: Category acceptance window expired'
            );
          }
        }
      }
    } catch (err) {
      console.error('[Cloudflare Scheduler Error]', err);
    }
  },
};
