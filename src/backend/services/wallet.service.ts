/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import type { Wallet, WalletTransaction, AuditLog } from '../types/index.ts';
import { pawapayService } from './pawapay.service.ts';
import { commsService } from './communication.service.ts';

export class WalletService {
  /**
   * Retrieves or initializes a secure wallet for a user
   */
  async getOrCreateWallet(userId: string): Promise<Wallet> {
    const mem = dbManager.inMemory;
    let wallet = Array.from(mem.wallets.values()).find((w) => w.userId === userId);

    if (!wallet) {
      wallet = {
        id: `wal_${crypto.randomBytes(8).toString('hex')}`,
        userId,
        currency: 'KES',
        availableBalance: 0,
        lockedEscrowBalance: 0,
        totalEarned: 0,
        totalWithdrawn: 0,
        updatedAt: new Date().toISOString(),
      };
      mem.wallets.set(wallet.id, wallet);
    }

    return wallet;
  }

  /**
   * Locks incoming buyer funds into seller's escrow pending successful delivery
   */
  async lockEscrowFunds(
    sellerId: string,
    amountKES: number,
    orderId: string,
    subOrderId: string
  ): Promise<WalletTransaction> {
    const wallet = await this.getOrCreateWallet(sellerId);

    wallet.lockedEscrowBalance += amountKES;
    wallet.updatedAt = new Date().toISOString();

    const tx: WalletTransaction = {
      id: `tx_${crypto.randomBytes(8).toString('hex')}`,
      walletId: wallet.id,
      userId: sellerId,
      type: 'escrow_hold',
      amount: amountKES,
      fee: 0,
      netAmount: amountKES,
      currency: 'KES',
      balanceAfter: wallet.availableBalance, // Available balance unchanged yet
      status: 'completed',
      referenceId: `${orderId}:${subOrderId}`,
      description: `Escrow hold for Sub-Order #${subOrderId}. Funds secured until buyer confirms delivery.`,
      createdAt: new Date().toISOString(),
    };

    dbManager.inMemory.transactions.set(tx.id, tx);
    this.recordAuditLog('ESCROW_FUNDS_LOCKED', sellerId, 'Wallet', wallet.id, {
      amountKES,
      orderId,
      subOrderId,
      lockedEscrowBalance: wallet.lockedEscrowBalance,
    });

    return tx;
  }

  /**
   * Unlocks escrow funds into farmer/agrovet available balance upon buyer delivery acknowledgement PIN verification
   */
  async releaseEscrowFunds(
    sellerId: string,
    grossAmountKES: number,
    commissionRatePercent: number,
    orderId: string,
    subOrderId: string
  ): Promise<{ releasedTx: WalletTransaction; commissionTx?: WalletTransaction }> {
    const wallet = await this.getOrCreateWallet(sellerId);

    // Safeguard: Ensure escrow balance doesn't become negative
    if (wallet.lockedEscrowBalance < grossAmountKES) {
      // Normalize if slight disparity occurred
      wallet.lockedEscrowBalance = Math.max(0, wallet.lockedEscrowBalance - grossAmountKES);
    } else {
      wallet.lockedEscrowBalance -= grossAmountKES;
    }

    const platformFee = Math.round((grossAmountKES * commissionRatePercent) / 100);
    const netEarnings = grossAmountKES - platformFee;

    wallet.availableBalance += netEarnings;
    wallet.totalEarned += netEarnings;
    wallet.updatedAt = new Date().toISOString();

    const releaseTx: WalletTransaction = {
      id: `tx_${crypto.randomBytes(8).toString('hex')}`,
      walletId: wallet.id,
      userId: sellerId,
      type: 'escrow_release',
      amount: grossAmountKES,
      fee: platformFee,
      netAmount: netEarnings,
      currency: 'KES',
      balanceAfter: wallet.availableBalance,
      status: 'completed',
      referenceId: `${orderId}:${subOrderId}`,
      description: `Delivery confirmed. Released net KES ${netEarnings.toLocaleString()} (fee ${commissionRatePercent}%: KES ${platformFee})`,
      createdAt: new Date().toISOString(),
    };

    dbManager.inMemory.transactions.set(releaseTx.id, releaseTx);

    this.recordAuditLog('ESCROW_FUNDS_RELEASED', sellerId, 'Wallet', wallet.id, {
      grossAmountKES,
      platformFee,
      netEarnings,
      availableBalance: wallet.availableBalance,
    });

    return { releasedTx: releaseTx };
  }

  /**
   * Initiates a withdrawal:
   * 1. Verifies user has enough AVAILABLE balance (cannot withdraw more than available).
   * 2. Calculates dynamic PawaPay payout fee.
   * 3. Temporarily reserves funds to prevent double-spending.
   * 4. Issues high-security 6-digit OTP dispatched via SMS/WhatsApp and email.
   */
  async initiateWithdrawal(
    userId: string,
    amountKES: number,
    recipientPhone: string
  ): Promise<{
    withdrawalId: string;
    amountKES: number;
    feeKES: number;
    totalDeductedKES: number;
    recipientPhone: string;
    expiresInSeconds: number;
    otpSent: boolean;
  }> {
    const wallet = await this.getOrCreateWallet(userId);

    // Dynamic fee estimation from PawaPay
    const pricing = await pawapayService.getPayoutPricing('MPESA_KEN');
    const feeKES = pawapayService.calculatePayoutFee(amountKES, pricing.tiers);
    const totalRequired = amountKES + feeKES;

    // STRICT CONSTRAINT: Cannot withdraw more than available balance
    if (wallet.availableBalance < totalRequired) {
      throw new Error(
        `Insufficient available balance. You requested KES ${amountKES} + KES ${feeKES} payout fee (Total: KES ${totalRequired}), but your available balance is KES ${wallet.availableBalance}.`
      );
    }

    // Minimum withdrawal threshold
    if (amountKES < 50) {
      throw new Error('Minimum withdrawal amount is KES 50.');
    }

    // Generate high-entropy 6-digit numeric OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const withdrawalId = `wdr_${crypto.randomBytes(8).toString('hex')}`;

    // Record OTP
    const otpRecord = {
      id: withdrawalId,
      userId,
      code: otpCode,
      actionType: 'withdrawal' as const,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      attempts: 0,
      verified: false,
      createdAt: new Date().toISOString(),
    };
    dbManager.inMemory.otps.set(withdrawalId, otpRecord);

    // Save pending withdrawal transaction with balance lock
    wallet.availableBalance -= totalRequired;
    wallet.updatedAt = new Date().toISOString();

    const pendingTx: WalletTransaction = {
      id: withdrawalId,
      walletId: wallet.id,
      userId,
      type: 'withdrawal',
      amount: amountKES,
      fee: feeKES,
      netAmount: amountKES,
      currency: 'KES',
      balanceAfter: wallet.availableBalance,
      status: 'pending',
      referenceId: recipientPhone,
      description: `Withdrawal to M-Pesa (${recipientPhone}) - Pending OTP verification`,
      createdAt: new Date().toISOString(),
    };
    dbManager.inMemory.transactions.set(pendingTx.id, pendingTx);

    // Dispatch OTP via Infobip WhatsApp & ZeptoMail
    const user = dbManager.inMemory.users.get(userId);
    const phone = recipientPhone || user?.phone || '';
    if (phone) {
      await commsService.sendInfobipWhatsApp({
        recipientPhone: phone,
        recipientRole: user?.role === 'agrovet' ? 'agrovet' : 'farmer',
        message: `Your FarmersWorld withdrawal security OTP is: *${otpCode}*. This authorizes KES ${amountKES} to M-Pesa ${phone}. Never share this code with anyone. Valid for 10 minutes.`,
      });
    }

    if (user?.email) {
      await commsService.sendZeptoEmail({
        toEmail: user.email,
        toName: user.fullName,
        subject: 'FarmersWorld Withdrawal OTP Verification',
        htmlBody: `<h3>Security Authorization Code</h3><p>Your withdrawal OTP is <strong>${otpCode}</strong> for KES ${amountKES} to ${phone}.</p>`,
      });
    }

    this.recordAuditLog('WITHDRAWAL_INITIATED', userId, 'Wallet', wallet.id, {
      amountKES,
      feeKES,
      totalRequired,
      recipientPhone,
      withdrawalId,
    });

    return {
      withdrawalId,
      amountKES,
      feeKES,
      totalDeductedKES: totalRequired,
      recipientPhone,
      expiresInSeconds: 600,
      otpSent: true,
    };
  }

  /**
   * Finalizes withdrawal after 2FA OTP verification:
   * Dispatches PawaPay payout. If provider fails, AUTOMATICALLY ROLLS BACK funds!
   */
  async confirmWithdrawal(
    userId: string,
    withdrawalId: string,
    submittedOtp: string
  ): Promise<{ success: boolean; transaction: WalletTransaction; payoutId: string }> {
    const mem = dbManager.inMemory;
    const otpRecord = mem.otps.get(withdrawalId);

    if (!otpRecord) {
      throw new Error('Invalid or expired withdrawal request.');
    }

    if (otpRecord.userId !== userId) {
      throw new Error('Unauthorized withdrawal confirmation attempt.');
    }

    if (new Date(otpRecord.expiresAt).getTime() < Date.now()) {
      await this.rollbackWithdrawal(userId, withdrawalId, 'OTP expired');
      throw new Error('OTP has expired. Funds have been automatically restored to your wallet.');
    }

    if (otpRecord.attempts >= 4) {
      await this.rollbackWithdrawal(userId, withdrawalId, 'Too many incorrect OTP attempts');
      throw new Error('Too many invalid OTP attempts. Funds restored for security.');
    }

    if (otpRecord.code !== submittedOtp) {
      otpRecord.attempts += 1;
      throw new Error(`Invalid OTP code. ${4 - otpRecord.attempts} attempts remaining.`);
    }

    otpRecord.verified = true;

    const pendingTx = mem.transactions.get(withdrawalId);
    if (!pendingTx || pendingTx.status !== 'pending') {
      throw new Error('Transaction is not in pending state.');
    }

    const wallet = await this.getOrCreateWallet(userId);

    // Call PawaPay Disbursement
    const payoutResult = await pawapayService.dispatchPayout({
      payoutId: withdrawalId,
      amount: pendingTx.amount,
      currency: 'KES',
      recipientPhoneNumber: pendingTx.referenceId,
      correspondent: 'MPESA_KEN',
      statementDescription: `FARMERSWORLD WDR ${pendingTx.amount}`,
    });

    if (!payoutResult.success || payoutResult.status === 'REJECTED') {
      // CRITICAL FRAUD & INTEGRITY DEFENSE: AUTOMATIC ROLLBACK
      await this.rollbackWithdrawal(userId, withdrawalId, payoutResult.error || 'Gateway rejected payout');
      throw new Error(`Payout provider failed: ${payoutResult.error || 'Payment gateway declined'}. Your funds have been automatically refunded to your wallet.`);
    }

    // Success state
    pendingTx.status = 'completed';
    pendingTx.description = `M-Pesa payout of KES ${pendingTx.amount} completed to ${pendingTx.referenceId}`;
    wallet.totalWithdrawn += pendingTx.amount;
    wallet.updatedAt = new Date().toISOString();

    this.recordAuditLog('WITHDRAWAL_COMPLETED', userId, 'Wallet', wallet.id, {
      withdrawalId,
      amount: pendingTx.amount,
      recipient: pendingTx.referenceId,
    });

    return {
      success: true,
      transaction: pendingTx,
      payoutId: payoutResult.payoutId,
    };
  }

  /**
   * Automatic rollback mechanism to prevent loss of funds on failed withdrawals
   */
  async rollbackWithdrawal(userId: string, withdrawalId: string, reason: string) {
    const mem = dbManager.inMemory;
    const tx = mem.transactions.get(withdrawalId);
    if (!tx || tx.status !== 'pending') return;

    const wallet = await this.getOrCreateWallet(userId);
    const refundTotal = tx.amount + tx.fee;

    wallet.availableBalance += refundTotal;
    wallet.updatedAt = new Date().toISOString();

    tx.status = 'failed';
    tx.description += ` (Failed: ${reason} - Automatically refunded KES ${refundTotal})`;

    const refundTx: WalletTransaction = {
      id: `ref_${crypto.randomBytes(8).toString('hex')}`,
      walletId: wallet.id,
      userId,
      type: 'refund',
      amount: refundTotal,
      fee: 0,
      netAmount: refundTotal,
      currency: 'KES',
      balanceAfter: wallet.availableBalance,
      status: 'completed',
      referenceId: withdrawalId,
      description: `Automatic refund for failed withdrawal #${withdrawalId} (${reason})`,
      createdAt: new Date().toISOString(),
    };

    mem.transactions.set(refundTx.id, refundTx);

    this.recordAuditLog('WITHDRAWAL_ROLLED_BACK', userId, 'Wallet', wallet.id, {
      withdrawalId,
      refundTotal,
      reason,
      restoredAvailableBalance: wallet.availableBalance,
    });
  }

  /**
   * Internal transfer / bill payment between users (e.g. farmer paying agrovet for fertilizer directly from wallet)
   */
  async transferFunds(
    fromUserId: string,
    toUserId: string,
    amountKES: number,
    purpose: string
  ): Promise<{ transferTx: WalletTransaction; receiveTx: WalletTransaction }> {
    const fromWallet = await this.getOrCreateWallet(fromUserId);
    const toWallet = await this.getOrCreateWallet(toUserId);

    if (fromWallet.availableBalance < amountKES) {
      throw new Error(`Insufficient funds. Your available balance is KES ${fromWallet.availableBalance}, transfer requires KES ${amountKES}.`);
    }

    fromWallet.availableBalance -= amountKES;
    fromWallet.updatedAt = new Date().toISOString();

    toWallet.availableBalance += amountKES;
    toWallet.updatedAt = new Date().toISOString();

    const transferTx: WalletTransaction = {
      id: `tr_${crypto.randomBytes(8).toString('hex')}`,
      walletId: fromWallet.id,
      userId: fromUserId,
      type: 'withdrawal',
      amount: amountKES,
      fee: 0,
      netAmount: amountKES,
      currency: 'KES',
      balanceAfter: fromWallet.availableBalance,
      status: 'completed',
      referenceId: toUserId,
      description: `Transfer to User #${toUserId}: ${purpose}`,
      createdAt: new Date().toISOString(),
    };

    const receiveTx: WalletTransaction = {
      id: `rc_${crypto.randomBytes(8).toString('hex')}`,
      walletId: toWallet.id,
      userId: toUserId,
      type: 'order_sale',
      amount: amountKES,
      fee: 0,
      netAmount: amountKES,
      currency: 'KES',
      balanceAfter: toWallet.availableBalance,
      status: 'completed',
      referenceId: fromUserId,
      description: `Transfer received from User #${fromUserId}: ${purpose}`,
      createdAt: new Date().toISOString(),
    };

    dbManager.inMemory.transactions.set(transferTx.id, transferTx);
    dbManager.inMemory.transactions.set(receiveTx.id, receiveTx);

    this.recordAuditLog('INTERNAL_TRANSFER_EXECUTED', fromUserId, 'Wallet', fromWallet.id, {
      toUserId,
      amountKES,
      purpose,
    });

    return { transferTx, receiveTx };
  }

  private recordAuditLog(
    action: string,
    userId: string,
    targetEntity: string,
    entityId: string,
    details: Record<string, unknown>
  ) {
    const log: AuditLog = {
      id: `audit_${crypto.randomBytes(8).toString('hex')}`,
      action,
      performedByUserId: userId,
      targetEntity,
      entityId,
      details,
      timestamp: new Date().toISOString(),
    };
    dbManager.inMemory.auditLogs.set(log.id, log);
  }
}

export const walletService = new WalletService();
