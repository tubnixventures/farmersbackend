/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { dbManager } from '../db/mongo.ts';
import { walletService } from '../services/wallet.service.ts';
import { authService } from '../services/auth.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import {
  initiateWithdrawalSchema,
  confirmWithdrawalSchema,
  transferFundsSchema,
} from '../validators/schemas.ts';
import type { User } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const walletApp = new Hono<AppEnv>();

/**
 * Get current user's wallet
 */
walletApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const wallet = await walletService.getOrCreateWallet(user.id);

  return c.json({
    success: true,
    wallet: {
      userId: wallet.userId,
      currency: wallet.currency,
      availableBalanceKES: wallet.availableBalance,
      lockedEscrowBalanceKES: wallet.lockedEscrowBalance,
      totalEarnedKES: wallet.totalEarned,
      totalWithdrawnKES: wallet.totalWithdrawn,
      updatedAt: wallet.updatedAt,
      hasPayoutPassword: !!user.payoutPasswordHash,
    },
  });
});

/**
 * Get wallet ledger transaction history
 */
walletApp.get('/transactions', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const mem = dbManager.inMemory;
  const txs = Array.from(mem.transactions.values())
    .filter((t) => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return c.json({ success: true, count: txs.length, transactions: txs });
});

/**
 * Step 1 of Withdrawal:
 * Verifies secondary Payout Password -> Checks Available Balance -> Reserves Funds -> Dispatches OTP
 */
walletApp.post('/withdraw', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = initiateWithdrawalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const { amountKES, payoutPassword, recipientPhone } = parsed.data;

  // 1. DUAL PASSWORD CHECK: Verify user's secondary payout password
  if (!user.payoutPasswordHash) {
    return c.json(
      {
        success: false,
        error: 'PayoutPasswordNotConfigured',
        message: 'Please configure a payout password under /api/auth/payout-password/set before withdrawing funds.',
      },
      400
    );
  }

  const isPayoutPassValid = await authService.verify(payoutPassword, user.payoutPasswordHash);
  if (!isPayoutPassValid) {
    return c.json({ success: false, error: 'Invalid payout password. Withdrawal rejected for security.' }, 401);
  }

  // 2. INITIATE WITHDRAWAL: Strict available balance check & OTP generation
  try {
    const result = await walletService.initiateWithdrawal(user.id, amountKES, recipientPhone);
    return c.json({
      success: true,
      message: `Security OTP sent to ${result.recipientPhone}. Please submit OTP to confirm disbursement.`,
      withdrawal: result,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Step 2 of Withdrawal:
 * Verifies OTP -> Executes PawaPay M-Pesa Payout -> Auto-Rollback on failure!
 */
walletApp.post('/withdraw/confirm', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = confirmWithdrawalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  try {
    const result = await walletService.confirmWithdrawal(user.id, parsed.data.withdrawalId, parsed.data.otp);
    return c.json({
      success: true,
      message: 'Withdrawal successfully processed and disbursed to your M-Pesa account.',
      payoutId: result.payoutId,
      transaction: result.transaction,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

/**
 * Internal Transfer / Bill payment between users (e.g. buying seeds directly from farmer wallet)
 */
walletApp.post('/transfer', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = transferFundsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const { toUserId, amountKES, purpose, payoutPassword } = parsed.data;

  // Verify secondary payout password
  if (!user.payoutPasswordHash) {
    return c.json({ success: false, error: 'Please set payout password first.' }, 400);
  }

  const isPassValid = await authService.verify(payoutPassword, user.payoutPasswordHash);
  if (!isPassValid) {
    return c.json({ success: false, error: 'Invalid payout password' }, 401);
  }

  const recipient = dbManager.inMemory.users.get(toUserId);
  if (!recipient) {
    return c.json({ success: false, error: 'Recipient user not found' }, 404);
  }

  try {
    const result = await walletService.transferFunds(user.id, toUserId, amountKES, purpose);
    return c.json({
      success: true,
      message: `Successfully transferred KES ${amountKES} to ${recipient.fullName} (${recipient.role}).`,
      transaction: result.transferTx,
    });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

export default walletApp;
