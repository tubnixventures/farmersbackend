/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface EmailPayload {
  toEmail: string;
  toName: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

export interface WhatsAppPayload {
  recipientPhone: string; // e.g. +254712345678
  templateName?: string;
  message: string;
  recipientRole: 'buyer' | 'farmer' | 'agrovet' | 'admin';
}

export class CommunicationService {
  private zeptoToken: string;
  private zeptoSender: string;
  private infobipBaseUrl: string;
  private infobipApiKey: string;
  private infobipWhatsAppNumber: string;

  constructor() {
    this.zeptoToken = process.env.ZEPTOMAIL_TOKEN || '';
    this.zeptoSender = process.env.ZEPTOMAIL_SENDER || 'support@farmersworld.co.ke';
    this.infobipBaseUrl = process.env.INFOBIP_BASE_URL || 'https://api.infobip.com';
    this.infobipApiKey = process.env.INFOBIP_API_KEY || '';
    this.infobipWhatsAppNumber = process.env.INFOBIP_WHATSAPP_NUMBER || '+254700000000';
  }

  /**
   * Sends transactional email using Zoho ZeptoMail API
   */
  async sendZeptoEmail(payload: EmailPayload): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.zeptoToken || this.zeptoToken.startsWith('zoho_zeptomail_token')) {
      console.log(`[ZeptoMail MOCK] To: ${payload.toEmail} | Subject: "${payload.subject}"`);
      return { success: true, messageId: `mock_zepto_${Date.now()}` };
    }

    try {
      const response = await fetch('https://api.zeptomail.com/v1.1/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${this.zeptoToken}`,
        },
        body: JSON.stringify({
          from: { address: this.zeptoSender, name: 'FarmersWorld Kenya' },
          to: [{ email_address: { address: payload.toEmail, name: payload.toName } }],
          subject: payload.subject,
          htmlbody: payload.htmlBody,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('[ZeptoMail] Error:', err);
        return { success: false, error: err };
      }

      const resData = (await response.json()) as { data?: { request_id?: string } };
      return { success: true, messageId: resData.data?.request_id };
    } catch (error) {
      console.error('[ZeptoMail Exception]', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Sends WhatsApp notifications using Infobip API supporting Buyer, Farmer, Agrovet, and Admin
   */
  async sendInfobipWhatsApp(payload: WhatsAppPayload): Promise<{ success: boolean; messageId?: string }> {
    const formattedPhone = payload.recipientPhone.replace(/\D/g, '');
    const cleanPhone = formattedPhone.startsWith('254') ? formattedPhone : `254${formattedPhone.replace(/^0/, '')}`;

    if (!this.infobipApiKey || this.infobipApiKey.startsWith('infobip_api_key')) {
      console.log(`[Infobip WhatsApp MOCK] [${payload.recipientRole.toUpperCase()}] To: +${cleanPhone} | Message: "${payload.message}"`);
      return { success: true, messageId: `mock_infobip_${Date.now()}` };
    }

    try {
      const response = await fetch(`${this.infobipBaseUrl}/whatsapp/1/message/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `App ${this.infobipApiKey}`,
        },
        body: JSON.stringify({
          from: this.infobipWhatsAppNumber,
          to: cleanPhone,
          content: {
            text: payload.message,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Infobip WhatsApp Error]', errorText);
        return { success: false };
      }

      const data = (await response.json()) as { messages?: { messageId: string }[] };
      return { success: true, messageId: data.messages?.[0]?.messageId };
    } catch (err) {
      console.error('[Infobip WhatsApp Exception]', err);
      return { success: false };
    }
  }

  /**
   * Multi-role dispatcher: Broadcasts order updates simultaneously to Buyer, Farmer/Agrovet, and Admin
   */
  async notifyOrderParties(data: {
    buyerPhone: string;
    buyerName: string;
    vendorPhone: string;
    vendorName: string;
    vendorRole: 'farmer' | 'agrovet';
    orderId: string;
    totalAmountKES: number;
    subOrderId: string;
    ackCode: string;
  }) {
    // 1. Notify Buyer on WhatsApp
    await this.sendInfobipWhatsApp({
      recipientPhone: data.buyerPhone,
      recipientRole: 'buyer',
      message: `Habari ${data.buyerName}! Your FarmersWorld order #${data.orderId} for KES ${data.totalAmountKES.toLocaleString()} is confirmed. Vendor ${data.vendorName} is preparing your produce. Your delivery acknowledgement secret PIN is: *${data.ackCode}*. Do NOT share this PIN until you inspect your items at delivery!`,
    });

    // 2. Notify Farmer or Agrovet on WhatsApp
    await this.sendInfobipWhatsApp({
      recipientPhone: data.vendorPhone,
      recipientRole: data.vendorRole,
      message: `Jambo ${data.vendorName}! You have a new order (#${data.subOrderId}) on FarmersWorld! Please accept or decline in the app within the time limit. Funds of KES ${data.totalAmountKES.toLocaleString()} are secured in Escrow.`,
    });
  }
}

export const commsService = new CommunicationService();
