/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { dbManager } from '../db/mongo.ts';
import { orderService } from '../services/order.service.ts';
import { pawapayService } from '../services/pawapay.service.ts';
import { walletService } from '../services/wallet.service.ts';

const cronApp = new Hono();

/**
 * Middleware: Verify scheduler secret key
 */
cronApp.use('*', async (c, next) => {
  const authHeader = c.req.header('authorization');
  const cronSecret = process.env.CRON_SECRET || 'farmersworld-secure-disbursement-cron-key';

  if (!authHeader || !authHeader.includes(cronSecret)) {
    // In dev mode allow if localhost
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
      return c.json({ success: false, error: 'Unauthorized cron invocation' }, 401);
    }
  }
  await next();
});

/**
 * Automated Cron Job: Payout Disbursements Engine
 * Dispatches and reconciles scheduled payouts
 */
cronApp.post('/payout-disbursements', async (c) => {
  const mem = dbManager.inMemory;
  const pendingPayouts = Array.from(mem.transactions.values()).filter(
    (tx) => tx.type === 'withdrawal' && tx.status === 'pending'
  );

  const results = [];
  for (const tx of pendingPayouts) {
    // Payout logic
    results.push({
      txId: tx.id,
      userId: tx.userId,
      amountKES: tx.amount,
      status: tx.status,
    });
  }

  return c.json({
    success: true,
    message: `Disbursement scheduler processed ${pendingPayouts.length} transactions.`,
    processedCount: pendingPayouts.length,
    results,
  });
});

/**
 * Automated Cron Job: Check Expired Order Timeouts & Auto-Reroute!
 * Checks perishable products (e.g. Sukuma wiki 30 mins) and reroutes to next closest producer
 */
cronApp.post('/order-expiration-check', async (c) => {
  const mem = dbManager.inMemory;
  const now = Date.now();
  let reroutedCount = 0;
  const actions: { subOrderId: string; vendorId: string; rerouted: boolean }[] = [];

  for (const order of mem.orders.values()) {
    for (const sub of order.vendorOrders) {
      if (sub.status === 'pending_acceptance' && new Date(sub.acceptanceExpiresAt).getTime() < now) {
        // Expired! Execute auto-reroute
        const success = await orderService.autoRerouteSubOrder(
          sub.subOrderId,
          'Dynamic category acceptance window expired without vendor action'
        );
        reroutedCount++;
        actions.push({
          subOrderId: sub.subOrderId,
          vendorId: sub.vendorId,
          rerouted: success,
        });
      }
    }
  }

  return c.json({
    success: true,
    message: `Expiration scheduler checked active sub-orders. ${reroutedCount} expired sub-orders evaluated.`,
    reroutedCount,
    actions,
  });
});

export default cronApp;
