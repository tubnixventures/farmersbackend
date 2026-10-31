/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import QRCode from 'qrcode';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import type { Order, Receipt, VendorSubOrder } from '../types/index.ts';
import { commsService } from './communication.service.ts';

export class ReceiptService {
  /**
   * Generates a digital receipt on-the-fly with scannable QR code.
   * STRICT ZERO-R2 STORAGE: Generated dynamically in memory from existing database records.
   */
  async generateReceipt(orderId: string, subOrderId?: string): Promise<Receipt> {
    const mem = dbManager.inMemory;
    const order = mem.orders.get(orderId);
    if (!order) throw new Error(`Order #${orderId} not found`);

    const buyer = mem.users.get(order.buyerId);
    let subOrder: VendorSubOrder | undefined;

    if (subOrderId) {
      subOrder = order.vendorOrders.find((s) => s.subOrderId === subOrderId);
    } else {
      subOrder = order.vendorOrders[0];
    }

    const vendor = subOrder ? mem.users.get(subOrder.vendorId) : null;
    const items = subOrder
      ? subOrder.items.map((i) => ({
          title: i.title,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          subtotal: i.subtotal,
        }))
      : order.vendorOrders.flatMap((vo) =>
          vo.items.map((i) => ({
            title: i.title,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
          }))
        );

    const subtotalKES = subOrder ? subOrder.subtotal : order.totalAmount;
    const deliveryFeeKES = subOrder ? Math.round(order.deliveryFee / order.vendorOrders.length) : order.deliveryFee;
    const totalAmountKES = subtotalKES + deliveryFeeKES;

    // Deterministic receipt number
    const year = new Date(order.createdAt).getFullYear();
    const receiptNumber = `RCP-${year}-${order.id.slice(-6).toUpperCase()}${subOrderId ? `-${subOrderId.slice(-4).toUpperCase()}` : ''}`;

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const verificationUrl = `${appUrl}/api/orders/receipts/verify/${receiptNumber}`;

    // Generate scannable QR Code as Data URI on the fly (Zero R2 storage)
    const qrCodeDataUri = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    const receipt: Receipt = {
      receiptNumber,
      orderId: order.id,
      subOrderId,
      buyerName: buyer?.fullName || 'Verified Buyer',
      buyerPhone: buyer?.phone || '',
      vendorName: vendor?.fullName || 'FarmersWorld Verified Producer',
      vendorPhone: vendor?.phone || '',
      vendorRole: subOrder?.vendorRole || 'farmer',
      items,
      subtotalKES,
      deliveryFeeKES,
      totalAmountKES,
      paymentMethod: order.paymentGateway.toUpperCase(),
      paymentReference: order.paymentReference || `MPESA_${order.id.slice(-8)}`,
      issuedAt: new Date().toISOString(),
      deliveryStatus: subOrder?.status || order.status,
      verificationUrl,
      qrCodeDataUri,
    };

    return receipt;
  }

  /**
   * Dispatches the generated receipt summary via Infobip WhatsApp to Buyer and Farmer
   */
  async sendReceiptViaWhatsApp(receipt: Receipt, recipientType: 'buyer' | 'farmer' | 'both' = 'both'): Promise<{ success: boolean; message: string }> {
    const formattedDate = new Date(receipt.issuedAt).toLocaleDateString('en-KE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const itemsSummary = receipt.items.map((it) => `• ${it.quantity} ${it.unit} ${it.title}: KES ${it.subtotal.toLocaleString()}`).join('\n');

    const whatsappMessage = 
`🧾 *FARMERSWORLD OFFICIAL RECEIPT*
*Receipt No:* ${receipt.receiptNumber}
*Date:* ${formattedDate}
*Vendor:* ${receipt.vendorName} (${receipt.vendorRole.toUpperCase()})
*Buyer:* ${receipt.buyerName}

🛒 *Items Purchased:*
${itemsSummary}

*Subtotal:* KES ${receipt.subtotalKES.toLocaleString()}
*Delivery Fee:* KES ${receipt.deliveryFeeKES.toLocaleString()}
*TOTAL PAID:* KES ${receipt.totalAmountKES.toLocaleString()}
*Payment Method:* ${receipt.paymentMethod}
*Payment Status:* ESCROW CONFIRMED

🔍 *Scan or Verify Online:*
${receipt.verificationUrl}

_Asante kwa kukuza uchumi wa mkulima! (FarmersWorld Kenya)_`;

    if ((recipientType === 'buyer' || recipientType === 'both') && receipt.buyerPhone) {
      await commsService.sendInfobipWhatsApp({
        recipientPhone: receipt.buyerPhone,
        recipientRole: 'buyer',
        message: whatsappMessage,
      });
    }

    if ((recipientType === 'farmer' || recipientType === 'both') && receipt.vendorPhone) {
      await commsService.sendInfobipWhatsApp({
        recipientPhone: receipt.vendorPhone,
        recipientRole: receipt.vendorRole === 'agrovet' ? 'agrovet' : 'farmer',
        message: whatsappMessage,
      });
    }

    return {
      success: true,
      message: `Receipt #${receipt.receiptNumber} dispatched via Infobip WhatsApp.`,
    };
  }
}

export const receiptService = new ReceiptService();
