/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

// GeoLocation Schema
export const geoLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  county: z.string().min(2, 'County is required'),
  subCounty: z.string().optional(),
  town: z.string().optional(),
  address: z.string().optional(),
});

// Authentication Schemas: Public registration strictly excludes admin and agent roles!
export const registerSchema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^(\+254|0)?[17]\d{8}$/, 'Valid Kenyan phone number required (e.g., +254712345678 or 0712345678)'),
  fullName: z.string().min(2),
  role: z.enum(['buyer', 'farmer', 'agrovet']),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  location: geoLocationSchema,
  deviceFingerprint: z.string().min(4, 'Device fingerprint required for session security'),
  deviceName: z.string().optional(),
});

// Admin-Only Staff Provisioning Schema
export const provisionStaffSchema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^(\+254|0)?[17]\d{8}$/, 'Valid Kenyan phone number required'),
  fullName: z.string().min(2),
  role: z.enum(['admin', 'support_agent']),
  temporaryPassword: z.string().min(8, 'Staff passwords must be at least 8 characters'),
  location: geoLocationSchema.optional(),
});

export const loginSchema = z.object({
  emailOrPhone: z.string().min(3),
  password: z.string().min(1),
  deviceFingerprint: z.string().min(4),
  deviceName: z.string().optional(),
});

export const setPayoutPasswordSchema = z.object({
  accountPassword: z.string().min(1, 'Current account password is required to set payout password'),
  payoutPassword: z.string().min(4, 'Payout password must be at least 4 characters or PIN digits'),
});

export const verifyPayoutPasswordSchema = z.object({
  payoutPassword: z.string().min(1, 'Payout password is required'),
});

// R2 Presigned Upload URL Schema
export const presignedUrlRequestSchema = z.object({
  folder: z.enum(['products', 'licenses', 'tickets', 'receipts', 'avatars']),
  fileExtension: z.string().min(2),
  contentType: z.string().min(3),
  maxSizeBytes: z.number().optional(),
});

// Category Schema
export const categorySchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().min(5),
  isPerishable: z.boolean(),
  defaultAcceptanceTimeoutMinutes: z.number().min(5).max(10080), // 5 min to 7 days
  commissionRatePercent: z.number().min(0).max(30),
  iconKey: z.string().optional(),
  isActive: z.boolean().default(true),
});

// Product Schemas
export const createProductSchema = z.object({
  categoryId: z.string().min(2),
  title: z.string().min(3),
  description: z.string().min(10),
  pricePerUnit: z.number().positive(),
  unit: z.string().min(1), // e.g. 'kg', 'crate', 'bunch', 'tray', 'bag_50kg'
  stockQuantity: z.number().nonnegative(),
  minOrderQuantity: z.number().positive().default(1),
  mediaKeys: z.array(z.string()).default([]),
  perishable: z.boolean().default(false),
  acceptanceTimeoutMinutes: z.number().min(10).optional(),
  tags: z.array(z.string()).default([]),
  location: geoLocationSchema.optional(), // Falls back to seller's location if omitted
});

export const updateProductSchema = createProductSchema.partial().extend({
  isAvailable: z.boolean().optional(),
});

export const updateStockSchema = z.object({
  stockQuantity: z.number().nonnegative('Stock cannot be negative'),
});

// Cart Schemas
export const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().nonnegative(),
});

// Order Schemas
export const checkoutSchema = z.object({
  deliveryAddress: z.string().min(3),
  buyerLocation: geoLocationSchema,
  buyerUrgencyNotes: z.string().optional(), // e.g. "15 eggs in 15 mins", "2 cocks within 2 hrs"
  preferSingleSeller: z.boolean().default(false),
  paymentGateway: z.enum(['paystack', 'pawapay']).default('pawapay'),
});

export const directOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().positive(),
    })
  ).min(1),
  deliveryAddress: z.string().min(3),
  buyerLocation: geoLocationSchema,
  buyerUrgencyNotes: z.string().optional(),
  preferSingleSeller: z.boolean().default(false),
  paymentGateway: z.enum(['paystack', 'pawapay']).default('pawapay'),
});

export const declineSubOrderSchema = z.object({
  reason: z.string().min(3),
});

export const dispatchSubOrderSchema = z.object({
  courierName: z.string().optional(),
  courierPhone: z.string().optional(),
  initialLat: z.number().optional(),
  initialLng: z.number().optional(),
});

export const gpsPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
  courierName: z.string().optional(),
  courierPhone: z.string().optional(),
  estimatedArrivalMinutes: z.number().min(0).optional(),
});

export const orderRatingSchema = z.object({
  rating: z.number().min(1).max(5),
  comment: z.string().min(3, 'Review comment must be at least 3 characters'),
  freshnessScore: z.number().min(1).max(5).optional(),
  deliveryScore: z.number().min(1).max(5).optional(),
  packagingScore: z.number().min(1).max(5).optional(),
});

export const deliveryAckSchema = z.object({
  code: z.string().length(6, 'Acknowledgement PIN must be 6 digits'),
});

// Agrovet Licensing Schema
export const submitLicenseSchema = z.object({
  businessName: z.string().min(3),
  licenseNumber: z.string().min(3),
  regulatoryBoard: z.enum([
    'Kenya Veterinary Board',
    'Pest Control Products Board',
    'KePHIS',
    'County Agribusiness Directorate',
  ]),
  certificateKey: z.string().min(3, 'R2 certificate file key required'),
  premiseAddress: z.string().min(3),
  premiseLocation: geoLocationSchema,
});

export const verifyLicenseSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});

// Wallet & Financial Schemas
export const initiateWithdrawalSchema = z.object({
  amountKES: z.number().min(50, 'Minimum withdrawal is KES 50'),
  payoutPassword: z.string().min(1, 'Payout password is required for security'),
  recipientPhone: z.string().regex(/^(\+254|0)?[17]\d{8}$/, 'Valid Kenyan M-Pesa phone number required'),
});

export const confirmWithdrawalSchema = z.object({
  withdrawalId: z.string().min(1),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const transferFundsSchema = z.object({
  toUserId: z.string().min(1),
  amountKES: z.number().positive(),
  purpose: z.string().min(3),
  payoutPassword: z.string().min(1),
});

// Support Ticket Schemas
export const createTicketSchema = z.object({
  subject: z.string().min(5),
  category: z.enum(['order_issue', 'payment_payout', 'delivery_dispute', 'license_verification', 'general']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  orderId: z.string().optional(),
  initialMessage: z.string().min(10),
  attachments: z.array(z.string()).default([]),
});

export const addTicketMessageSchema = z.object({
  message: z.string().min(1),
  attachments: z.array(z.string()).default([]),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(['open', 'agent_assigned', 'waiting_user', 'resolved', 'closed']),
});

// Market Price Trend Submission Schema
export const submitMarketPriceSchema = z.object({
  commodityName: z.string().min(2),
  categorySlug: z.string().min(2),
  county: z.string().min(2),
  marketName: z.string().min(2),
  unit: z.string().min(1),
  wholesalePriceKES: z.number().positive(),
  retailPriceKES: z.number().positive(),
  minPriceKES: z.number().positive(),
  maxPriceKES: z.number().positive(),
  supplyLevel: z.enum(['low', 'normal', 'high']),
  trendDirection: z.enum(['up', 'down', 'stable']),
});

// Banner Schemas
export const createBannerSchema = z.object({
  title: z.string().min(3, 'Banner title required'),
  subtitle: z.string().optional(),
  imageKey: z.string().min(3, 'R2 media storage key required'),
  actionUrl: z.string().optional(),
  position: z.enum(['home_hero', 'category_header', 'market_trends', 'popup_notice', 'footer_promo']),
  targetRole: z.enum(['buyer', 'farmer', 'agrovet', 'admin', 'all']).default('all'),
  targetCounty: z.string().default('All'),
  priority: z.number().min(1).max(10).default(5),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const updateBannerSchema = createBannerSchema.partial();
