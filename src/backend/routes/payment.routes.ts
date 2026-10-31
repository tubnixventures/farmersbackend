/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { pawapayService } from '../services/pawapay.service.ts';
import { paystackService } from '../services/paystack.service.ts';
import { orderService } from '../services/order.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import type { User } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const paymentApp = new Hono<AppEnv>();

/**
 * PawaPay: Real-time payout pricing endpoint
 */
paymentApp.get('/pawapay/pricing', async (c) => {
  const correspondent = (c.req.query('correspondent') as 'MPESA_KEN' | 'AIRTEL_KEN') || 'MPESA_KEN';
  const pricing = await pawapayService.getPayoutPricing(correspondent);
  return c.json({ success: true, pricing });
});

/**
 * PawaPay: Initiate Deposit (M-Pesa STK push for draft order)
 */
paymentApp.post('/pawapay/deposit', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const { amountKES, phoneNumber, orderId } = await c.req.json();

  if (!amountKES || amountKES <= 0) {
    return c.json({ success: false, error: 'Valid deposit amount required' }, 400);
  }

  const depositId = `dep_${crypto.randomBytes(8).toString('hex')}`;
  const result = await pawapayService.initiateDeposit({
    depositId,
    amount: amountKES,
    currency: 'KES',
    phoneNumber: phoneNumber || user.phone,
    correspondent: 'MPESA_KEN',
    description: orderId ? `FW Order ${orderId.slice(-6)}` : 'FarmersWorld Deposit',
  });

  return c.json({ ...result, orderId });
});

/**
 * PawaPay: Webhook Callback
 * CRITICAL BUSINESS RULE:
 * Order is in 'draft' until paid.
 * Once PawaPay confirms payment, order transitions to 'paid', escrow is locked, and seller is notified!
 */
paymentApp.post('/pawapay/webhook', async (c) => {
  const body = await c.req.text();
  const signature = c.req.header('x-pawapay-signature') || '';

  const isValid = pawapayService.verifyWebhookSignature(body, signature, process.env.PAWAPAY_API_KEY || '');
  if (!isValid) {
    return c.json({ success: false, error: 'Invalid webhook signature' }, 401);
  }

  try {
    const payload = JSON.parse(body);
    const depositId = payload.depositId;
    const status = payload.status; // 'COMPLETED' | 'FAILED'

    if (status === 'COMPLETED' && payload.orderId) {
      await orderService.markOrderPaid(payload.orderId, 'pawapay', depositId);
    }

    return c.json({ success: true, message: 'PawaPay webhook processed' });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * PawaPay: Test Simulation of Payment Confirmation
 */
paymentApp.post('/pawapay/simulate-payment-success', async (c) => {
  const { orderId } = await c.req.json();
  if (!orderId) return c.json({ success: false, error: 'orderId is required' }, 400);

  const reference = `sim_pawa_${Date.now()}`;
  try {
    const updatedOrder = await orderService.markOrderPaid(orderId, 'pawapay', reference);
    return c.json({
      success: true,
      message: `Simulated PawaPay confirmation! Order #${orderId} marked PAID. Escrow locked. Sellers notified.`,
      order: updatedOrder,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Paystack: Initialize transaction (Order or Subscription)
 */
paymentApp.post('/paystack/initialize', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const { amountKES, purpose, orderId } = await c.req.json();

  const reference = `fw_pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  const result = await paystackService.initializeTransaction({
    email: user.email,
    amountKES,
    reference,
    callbackUrl: `${appUrl}/api/payments/paystack/callback`,
    metadata: {
      userId: user.id,
      purpose: purpose || 'order_payment',
      orderId,
    },
  });

  return c.json(result);
});

/**
 * Paystack: Verify transaction
 */
paymentApp.get('/paystack/verify/:reference', authMiddleware, async (c) => {
  const ref = c.req.param('reference')!;
  const result = await paystackService.verifyTransaction(ref);
  return c.json(result);
});

/**
 * Paystack: Webhook Handler
 * CRITICAL BUSINESS RULE:
 * Handles 'charge.success' to transition order from 'draft' to 'paid', lock escrow, and alert sellers!
 */
paymentApp.post('/paystack/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature');

  const isValid = paystackService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    return c.json({ success: false, error: 'Invalid Paystack signature' }, 401);
  }

  try {
    const payload = JSON.parse(rawBody);
    if (payload.event === 'charge.success') {
      const orderId = payload.data?.metadata?.orderId;
      const ref = payload.data?.reference;

      if (orderId && ref) {
        await orderService.markOrderPaid(orderId, 'paystack', ref);
      }
    }

    return c.json({ status: true, message: 'Paystack webhook received and order processed' });
  } catch (err) {
    return c.json({ status: false, error: (err as Error).message }, 400);
  }
});

/**
 * Paystack: Test Simulation of Payment Confirmation
 */
paymentApp.post('/paystack/simulate-payment-success', async (c) => {
  const { orderId } = await c.req.json();
  if (!orderId) return c.json({ success: false, error: 'orderId is required' }, 400);

  const reference = `sim_paystack_${Date.now()}`;
  try {
    const updatedOrder = await orderService.markOrderPaid(orderId, 'paystack', reference);
    return c.json({
      success: true,
      message: `Simulated Paystack confirmation! Order #${orderId} marked PAID. Escrow locked. Sellers notified.`,
      order: updatedOrder,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Farmer Subscription: Get status & free trial information
 */
paymentApp.get('/subscriptions/farmer/status', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  if (user.role !== 'farmer') {
    return c.json({ success: false, error: 'Only farmers have subscription management' }, 400);
  }

  const sub = user.subscription;
  const now = Date.now();
  const trialEnd = sub?.trialEndDate ? new Date(sub.trialEndDate).getTime() : 0;
  const daysRemainingInTrial = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));

  return c.json({
    success: true,
    subscription: sub,
    summary: {
      isTrialActive: sub?.status === 'trial' && daysRemainingInTrial > 0,
      daysRemainingInTrial,
      monthlyFeeKES: 20, // KSH 20 / month
      autoRenew: sub?.autoRenew ?? true,
    },
  });
});

/**
 * Farmer Subscription: Activate / Renew (KES 20 / month)
 */
paymentApp.post('/subscriptions/farmer/renew', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  if (user.role !== 'farmer') {
    return c.json({ success: false, error: 'Only farmers require this subscription' }, 400);
  }

  const now = new Date();
  const oneMonthLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  user.subscription = {
    status: 'active',
    trialStartDate: user.subscription?.trialStartDate || now.toISOString(),
    trialEndDate: user.subscription?.trialEndDate || now.toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: oneMonthLater.toISOString(),
    monthlyFee: 20,
    autoRenew: true,
    paymentMethod: 'paystack',
  };
  user.updatedAt = now.toISOString();

  return c.json({
    success: true,
    message: 'Farmer subscription successfully activated for 30 days (KES 20).',
    subscription: user.subscription,
  });
});

export default paymentApp;
