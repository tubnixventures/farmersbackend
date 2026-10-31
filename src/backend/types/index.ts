/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'buyer' | 'farmer' | 'agrovet' | 'admin' | 'support_agent';

export interface GeoLocation {
  lat: number;
  lng: number;
  county: string;
  subCounty?: string;
  town?: string;
  address?: string;
}

export interface DeviceSession {
  sessionId: string;
  deviceFingerprint: string;
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
  lastActive: string;
  createdAt: string;
  isRevoked: boolean;
}

export interface UserSubscription {
  status: 'trial' | 'active' | 'past_due' | 'cancelled';
  trialStartDate: string;
  trialEndDate: string; // 2 months (60 days) free
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  monthlyFee: number; // 20 KES
  autoRenew: boolean;
  paymentMethod?: 'paystack' | 'pawapay';
}

export interface User {
  id: string;
  email: string;
  phone: string; // Kenyan format (+254...)
  fullName: string;
  role: UserRole;
  passwordHash: string;
  payoutPasswordHash?: string; // Secondary password for financial withdrawals
  location: GeoLocation;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  subscription?: UserSubscription; // Required for farmers
  activeSessionId?: string; // Single-device enforcement
  deviceSessions: DeviceSession[];
  agrovetLicenseId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  isPerishable: boolean;
  defaultAcceptanceTimeoutMinutes: number; // e.g. 30m for greens, 120m for eggs, 1440m for seeds
  commissionRatePercent: number; // platform commission e.g. 5% for agrovet, 2% general
  iconKey?: string;
  isActive: boolean;
}

export type BannerPosition = 'home_hero' | 'category_header' | 'market_trends' | 'popup_notice' | 'footer_promo';

export interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  imageKey: string; // R2 object storage key only (DB never stores full url)
  actionUrl?: string; // Deep link or filter URL (e.g. /products?category=certified-seeds)
  position: BannerPosition;
  targetRole?: UserRole | 'all';
  targetCounty?: string; // Regional targeting e.g. 'Kiambu', 'Nakuru', 'All'
  priority: number; // 1 (highest) to 10
  startDate: string;
  endDate?: string;
  isActive: boolean;
  clickCount: number;
  impressionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  sellerId: string;
  sellerRole: 'farmer' | 'agrovet';
  categoryId: string;
  categorySlug: string;
  title: string;
  description: string;
  pricePerUnit: number; // KES
  unit: string; // 'kg', 'bunch', 'crate', 'tray', 'piece', 'liter', 'bag_50kg', etc.
  stockQuantity: number;
  minOrderQuantity: number;
  mediaKeys: string[]; // R2 object keys only
  location: GeoLocation;
  isAvailable: boolean;
  perishable: boolean;
  acceptanceTimeoutMinutes: number;
  tags: string[];
  embeddingVector?: number[]; // Cloudflare AI embedding cache
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  sellerId: string;
  sellerRole: 'farmer' | 'agrovet';
  title: string;
  unit: string;
  location: GeoLocation;
}

export interface Cart {
  userId: string;
  items: CartItem[];
  updatedAt: string;
}

export type SubOrderStatus = 
  | 'draft'
  | 'pending_acceptance'
  | 'accepted'
  | 'declined'
  | 'rerouted'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export interface OrderStatusHistoryEntry {
  status: string;
  timestamp: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  note?: string;
  updatedBy: string; // 'system' | 'gateway' | 'buyer' | 'farmer' | 'courier'
}

export interface LiveGpsTracking {
  lat: number;
  lng: number;
  speedKmh?: number;
  heading?: number;
  lastPingAt: string;
  courierName?: string;
  courierPhone?: string;
  estimatedArrivalMinutes?: number;
}

export interface VendorSubOrder {
  subOrderId: string;
  vendorId: string;
  vendorRole: 'farmer' | 'agrovet';
  vendorLocation: GeoLocation;
  items: {
    productId: string;
    title: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    unit: string;
  }[];
  subtotal: number;
  status: SubOrderStatus;
  statusHistory: OrderStatusHistoryEntry[];
  liveGps?: LiveGpsTracking;
  acceptanceExpiresAt: string; // Dynamic timeout (e.g. 30 min for vegetables)
  acceptedAt?: string;
  declinedAt?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  declineReason?: string;
  rerouteHistory: {
    fromVendorId: string;
    toVendorId: string;
    reason: string;
    timestamp: string;
  }[];
}

export interface Order {
  id: string;
  buyerId: string;
  buyerLocation: GeoLocation;
  deliveryAddress: string;
  buyerUrgencyNotes?: string; // e.g. "15 eggs in 15 mins", "2 cocks within 2 hrs"
  vendorOrders: VendorSubOrder[];
  totalAmount: number;
  deliveryFee: number;
  grandTotal: number;
  paymentGateway: 'paystack' | 'pawapay';
  paymentReference?: string;
  status: 'draft' | 'paid' | 'processing' | 'dispatched' | 'delivered' | 'cancelled';
  paymentStatus: 'draft' | 'pending' | 'paid' | 'failed' | 'refunded';
  escrowStatus: 'unfunded' | 'locked' | 'partially_released' | 'fully_released' | 'refunded';
  statusHistory: OrderStatusHistoryEntry[];
  deliveryAckCode: string; // 6-digit secret code shared to buyer for proof of receipt
  isSingleVendorOrder: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRating {
  id: string;
  orderId: string;
  subOrderId: string;
  buyerId: string;
  buyerName: string;
  vendorId: string;
  rating: number; // 1-5
  comment: string;
  freshnessScore?: number; // 1-5
  deliveryScore?: number; // 1-5
  packagingScore?: number; // 1-5
  createdAt: string;
}

export interface Receipt {
  receiptNumber: string; // RCP-YYYY-XXXXXX
  orderId: string;
  subOrderId?: string;
  buyerName: string;
  buyerPhone: string;
  vendorName: string;
  vendorPhone: string;
  vendorRole: 'farmer' | 'agrovet';
  items: {
    title: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    subtotal: number;
  }[];
  subtotalKES: number;
  deliveryFeeKES: number;
  totalAmountKES: number;
  paymentMethod: string;
  paymentReference: string;
  issuedAt: string;
  deliveryStatus: string;
  verificationUrl: string;
  qrCodeDataUri: string; // Generated on the fly, NOT saved in R2
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  userId: string;
  type: 'order_sale' | 'withdrawal' | 'subscription_fee' | 'commission_deduction' | 'escrow_hold' | 'escrow_release' | 'refund';
  amount: number;
  fee: number;
  netAmount: number;
  currency: 'KES';
  balanceAfter: number;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  referenceId: string; // orderId or payout reference
  description: string;
  createdAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  currency: 'KES';
  availableBalance: number; // Free funds available to withdraw
  lockedEscrowBalance: number; // Locked until buyer confirms delivery
  totalEarned: number;
  totalWithdrawn: number;
  updatedAt: string;
}

export interface AgrovetLicense {
  id: string;
  agrovetUserId: string;
  businessName: string;
  licenseNumber: string;
  regulatoryBoard: 'Kenya Veterinary Board' | 'Pest Control Products Board' | 'KePHIS' | 'County Agribusiness Directorate';
  certificateKey: string; // R2 storage key
  premiseAddress: string;
  premiseLocation: GeoLocation;
  isVerified: boolean;
  verifiedAt?: string;
  verifiedByAdminId?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface PriceTrend {
  id: string;
  commodityName: string;
  categorySlug: string;
  county: string;
  marketName: string;
  unit: string;
  wholesalePriceKES: number;
  retailPriceKES: number;
  minPriceKES: number;
  maxPriceKES: number;
  supplyLevel: 'low' | 'normal' | 'high';
  trendDirection: 'up' | 'down' | 'stable';
  recordedAt: string;
}

export interface SupportTicketMessage {
  id: string;
  senderId: string;
  senderRole: UserRole;
  senderName: string;
  message: string;
  attachments?: string[]; // R2 keys
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  orderId?: string;
  subject: string;
  category: 'order_issue' | 'payment_payout' | 'delivery_dispute' | 'license_verification' | 'general';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'agent_assigned' | 'waiting_user' | 'resolved' | 'closed';
  messages: SupportTicketMessage[];
  assignedAgentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  performedByUserId?: string;
  targetEntity: string;
  entityId: string;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface OtpRecord {
  id: string;
  userId: string;
  code: string;
  actionType: 'withdrawal' | 'device_reauth' | 'order_ack' | 'password_reset';
  expiresAt: string;
  attempts: number;
  verified: boolean;
  createdAt: string;
}
