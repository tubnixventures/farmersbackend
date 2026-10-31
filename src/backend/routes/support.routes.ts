/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.ts';
import {
  createTicketSchema,
  addTicketMessageSchema,
  updateTicketStatusSchema,
} from '../validators/schemas.ts';
import type { User, SupportTicket, SupportTicketMessage } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const supportApp = new Hono<AppEnv>();

/**
 * List support tickets
 */
supportApp.get('/tickets', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const mem = dbManager.inMemory;
  const allTickets = Array.from(mem.supportTickets.values());

  if (user.role === 'admin' || user.role === 'support_agent') {
    return c.json({ success: true, count: allTickets.length, tickets: allTickets });
  }

  const userTickets = allTickets.filter((t) => t.userId === user.id);
  return c.json({ success: true, count: userTickets.length, tickets: userTickets });
});

/**
 * Create asynchronous support ticket / inquiry
 */
supportApp.post('/tickets', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = createTicketSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const ticketId = `tkt_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  const firstMsg: SupportTicketMessage = {
    id: `msg_${crypto.randomBytes(6).toString('hex')}`,
    senderId: user.id,
    senderRole: user.role,
    senderName: user.fullName,
    message: parsed.data.initialMessage,
    attachments: parsed.data.attachments,
    createdAt: now,
  };

  const ticket: SupportTicket = {
    id: ticketId,
    userId: user.id,
    userName: user.fullName,
    userRole: user.role,
    orderId: parsed.data.orderId,
    subject: parsed.data.subject,
    category: parsed.data.category,
    priority: parsed.data.priority,
    status: 'open',
    messages: [firstMsg],
    createdAt: now,
    updatedAt: now,
  };

  mem.supportTickets.set(ticket.id, ticket);

  return c.json({ success: true, message: 'Support ticket submitted. Our agent will respond asynchronously.', ticket }, 201);
});

/**
 * Get ticket details & message thread
 */
supportApp.get('/tickets/:id', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const id = c.req.param('id')!;
  const ticket = dbManager.inMemory.supportTickets.get(id);

  if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

  const canView =
    ticket.userId === user.id || user.role === 'admin' || user.role === 'support_agent';
  if (!canView) {
    return c.json({ success: false, error: 'Unauthorized to view ticket' }, 403);
  }

  return c.json({ success: true, ticket });
});

/**
 * Reply to asynchronous support ticket
 */
supportApp.post('/tickets/:id/messages', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const id = c.req.param('id')!;
  const ticket = dbManager.inMemory.supportTickets.get(id);

  if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

  const canReply =
    ticket.userId === user.id || user.role === 'admin' || user.role === 'support_agent';
  if (!canReply) return c.json({ success: false, error: 'Unauthorized' }, 403);

  const body = await c.req.json();
  const parsed = addTicketMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const newMsg: SupportTicketMessage = {
    id: `msg_${crypto.randomBytes(6).toString('hex')}`,
    senderId: user.id,
    senderRole: user.role,
    senderName: user.fullName,
    message: parsed.data.message,
    attachments: parsed.data.attachments,
    createdAt: new Date().toISOString(),
  };

  ticket.messages.push(newMsg);
  ticket.updatedAt = new Date().toISOString();

  // If user replies, mark waiting for agent; if agent replies, mark waiting for user
  if (user.role === 'admin' || user.role === 'support_agent') {
    ticket.status = 'waiting_user';
  } else {
    ticket.status = 'open';
  }

  return c.json({ success: true, message: 'Reply posted', ticket });
});

/**
 * Update ticket status
 */
supportApp.patch('/tickets/:id/status', authMiddleware, requireRole('admin', 'support_agent'), async (c) => {
  const id = c.req.param('id')!;
  const ticket = dbManager.inMemory.supportTickets.get(id);
  if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

  const body = await c.req.json();
  const parsed = updateTicketStatusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  ticket.status = parsed.data.status;
  ticket.updatedAt = new Date().toISOString();

  return c.json({ success: true, message: `Ticket status updated to ${ticket.status}`, ticket });
});

/**
 * Public Knowledgebase FAQs
 */
supportApp.get('/faqs', async (c) => {
  const faqs = [
    {
      q: 'How does the KES 20/month subscription work for farmers?',
      a: 'Every newly registered farmer receives a complimentary 60-day (2 months) free trial. After 60 days, farmers pay KES 20 per month to maintain their produce listings.',
    },
    {
      q: 'How are farmer earnings protected during delivery?',
      a: 'When an order is placed, buyer funds are immediately locked into Escrow. Once the buyer verifies and inputs the 6-digit delivery acknowledgement PIN, the funds are instantly released into the farmer’s available balance.',
    },
    {
      q: 'Why does FarmersWorld require two passwords?',
      a: 'For financial safety, you have an account login password and a secondary Payout Password. Before any M-Pesa withdrawal is initiated, you must input your Payout Password, followed by a one-time OTP.',
    },
    {
      q: 'What is the dynamic order acceptance threshold?',
      a: 'Perishable goods like Sukuma wiki and spinach have a 30-minute acceptance window. If the farmer cannot accept within 30 minutes, our automated routing engine instantly re-assigns the sub-order to the nearest qualified farmer using Haversine formulas.',
    },
    {
      q: 'What regulations govern Agrovets on the platform?',
      a: 'Agrovets must submit official licensing credentials from KePHIS, Kenya Veterinary Board, or Pest Control Products Board, verified by our compliance team before selling inputs.',
    },
  ];

  return c.json({ success: true, count: faqs.length, faqs });
});

export default supportApp;
