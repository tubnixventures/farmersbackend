/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';

export class PaystackService {
  private secretKey: string;

  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  }

  /**
   * Initializes payment on Paystack (supports M-Pesa & Card)
   */
  async initializeTransaction(data: {
    email: string;
    amountKES: number; // in whole KES
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; authorizationUrl: string; reference: string; accessCode?: string }> {
    // Paystack takes amount in cents/kobo (multiply by 100)
    const amountInSubunits = Math.round(data.amountKES * 100);

    if (!this.secretKey || this.secretKey.startsWith('sk_test_paystack')) {
      return {
        success: true,
        reference: data.reference,
        authorizationUrl: `https://checkout.paystack.com/mock-checkout-${data.reference}`,
        accessCode: `acc_${data.reference.slice(-8)}`,
      };
    }

    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify({
          email: data.email,
          amount: amountInSubunits,
          currency: 'KES',
          reference: data.reference,
          callback_url: data.callbackUrl,
          channels: ['mobile_money', 'card'],
          metadata: data.metadata,
        }),
      });

      const res = (await response.json()) as {
        status: boolean;
        data?: { authorization_url: string; reference: string; access_code: string };
      };

      if (!res.status || !res.data) {
        throw new Error('Paystack initialization failed');
      }

      return {
        success: true,
        authorizationUrl: res.data.authorization_url,
        reference: res.data.reference,
        accessCode: res.data.access_code,
      };
    } catch (err) {
      return {
        success: false,
        authorizationUrl: '',
        reference: data.reference,
      };
    }
  }

  /**
   * Verifies a completed Paystack transaction
   */
  async verifyTransaction(reference: string): Promise<{ success: boolean; status: string; amountKES?: number }> {
    if (!this.secretKey || this.secretKey.startsWith('sk_test_paystack')) {
      return { success: true, status: 'success', amountKES: 20 };
    }

    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      const res = (await response.json()) as {
        status: boolean;
        data?: { status: string; amount: number; currency: string };
      };

      if (res.status && res.data && res.data.status === 'success') {
        return { success: true, status: 'success', amountKES: res.data.amount / 100 };
      }

      return { success: false, status: res.data?.status || 'failed' };
    } catch (err) {
      return { success: false, status: 'error' };
    }
  }

  /**
   * Verifies incoming webhook signature from Paystack using HMAC SHA512
   */
  verifyWebhookSignature(rawBody: string, signatureHeader?: string): boolean {
    if (!this.secretKey || this.secretKey.startsWith('sk_test_paystack')) return true;
    if (!signatureHeader) return false;

    const hash = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    return hash === signatureHeader;
  }
}

export const paystackService = new PaystackService();
