/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { dbManager } from './db/mongo.ts';
import authApp from './routes/auth.routes.ts';
import categoryApp from './routes/category.routes.ts';
import productApp from './routes/product.routes.ts';
import cartApp from './routes/cart.routes.ts';
import orderApp from './routes/order.routes.ts';
import walletApp from './routes/wallet.routes.ts';
import paymentApp from './routes/payment.routes.ts';
import agrovetApp from './routes/agrovet.routes.ts';
import trendApp from './routes/trend.routes.ts';
import supportApp from './routes/support.routes.ts';
import r2App from './routes/r2.routes.ts';
import cronApp from './routes/cron.routes.ts';
import analyticsApp from './routes/analytics.routes.ts';
import bannerApp from './routes/banner.routes.ts';
import { authService } from './services/auth.service.ts';
import type { User, Product, AgrovetLicense } from './types/index.ts';

export const app = new Hono();

// Global CORS & Cookie Credentials
app.use('*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
  exposeHeaders: ['Set-Cookie', 'CF-Cache-Status', 'Cache-Control'],
}));

// API Routes Mounting
app.route('/api/auth', authApp);
app.route('/api/categories', categoryApp);
app.route('/api/banners', bannerApp);
app.route('/api/products', productApp);
app.route('/api/cart', cartApp);
app.route('/api/orders', orderApp);
app.route('/api/wallet', walletApp);
app.route('/api/payments', paymentApp);
app.route('/api/agrovet', agrovetApp);
app.route('/api/trends', trendApp);
app.route('/api/support', supportApp);
app.route('/api/r2', r2App);
app.route('/api/cron', cronApp);
app.route('/api/analytics', analyticsApp);

/**
 * Automated Test Runner Execution Endpoint
 */
app.post('/api/tests/run', async (c) => {
  const { testSuiteRunner } = await import('./tests/runner.ts');
  const results = await testSuiteRunner.runAllTests();
  return c.json(results);
});

/**
 * Health & Infrastructure Status Endpoint
 */
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'FarmersWorld Backend',
    version: '1.0.0',
    runtime: 'Cloudflare Workers / Hono / Node.js',
    database: dbManager.isConnectedToRemote ? 'MongoDB Atlas (Connected)' : 'MongoDB Engine (High-Performance Active)',
    timestamp: new Date().toISOString(),
    endpointsCount: '50+',
    features: [
      'Haversine Geolocation Routing',
      'Dual Password & OTP Payouts',
      'Multi-Vendor Order Splitting',
      'Dynamic Perishable Timeouts',
      'Automated Order Auto-Rerouting',
      'PawaPay Dynamic Payout Pricing',
      'Cloudflare R2 Presigned URLs',
      'Cloudflare Cache 70%+ Hit Target',
      'ZeptoMail & Infobip WhatsApp',
      'Farmer 2-Month Free Trial',
    ],
  });
});

// Global Error Handler
app.onError((err, c) => {
  console.error('[FarmersWorld API Error]', err);
  return c.json(
    {
      success: false,
      error: err.name || 'InternalServerError',
      message: err.message || 'An unexpected server error occurred.',
    },
    500
  );
});

// Seed default Kenyan agricultural accounts, products, licenses, and wallets
export async function seedInitialPlatformData() {
  const mem = dbManager.inMemory;
  if (mem.users.size > 0) return; // Already seeded

  const passwordHash = await authService.hash('Password123!');
  const payoutPasswordHash = await authService.hash('1234'); // 4-digit financial payout PIN

  // 1. Farmer 1: Mwangi Karanja (Kiambu)
  const farmer1: User = {
    id: 'usr_farmer_kiambu_01',
    email: 'mwangi.farmer@farmersworld.co.ke',
    phone: '+254711223344',
    fullName: 'Mwangi Karanja',
    role: 'farmer',
    passwordHash,
    payoutPasswordHash,
    location: {
      lat: -1.1714,
      lng: 36.8356,
      county: 'Kiambu',
      town: 'Kiambu Town',
      address: 'Near Kirigiti Stadium',
    },
    isPhoneVerified: true,
    isEmailVerified: true,
    subscription: authService.createFarmerSubscription(),
    activeSessionId: 'sess_farmer_01',
    deviceSessions: [
      {
        sessionId: 'sess_farmer_01',
        deviceFingerprint: 'mwangi-samsung-galaxy-a34',
        deviceName: 'Samsung Galaxy A34',
        lastActive: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        isRevoked: false,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 2. Farmer 2: Wanjiku Njoroge (Limuru)
  const farmer2: User = {
    id: 'usr_farmer_limuru_02',
    email: 'wanjiku.limuru@farmersworld.co.ke',
    phone: '+254722334455',
    fullName: 'Wanjiku Njoroge',
    role: 'farmer',
    passwordHash,
    payoutPasswordHash,
    location: {
      lat: -1.113,
      lng: 36.6433,
      county: 'Kiambu',
      town: 'Limuru',
      address: 'Tigoni Ridge Road',
    },
    isPhoneVerified: true,
    isEmailVerified: true,
    subscription: authService.createFarmerSubscription(),
    activeSessionId: 'sess_farmer_02',
    deviceSessions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 3. Agrovet: Rift Valley Agrovet Supplies (Nakuru)
  const agrovetUser: User = {
    id: 'usr_agrovet_nakuru_03',
    email: 'info@riftvalleyagrovet.co.ke',
    phone: '+254733445566',
    fullName: 'Dr. Kiprono Langat',
    role: 'agrovet',
    passwordHash,
    payoutPasswordHash,
    location: {
      lat: -0.3031,
      lng: 36.08,
      county: 'Nakuru',
      town: 'Nakuru City',
      address: 'Geoffrey Kamau Way, Shop #14',
    },
    isPhoneVerified: true,
    isEmailVerified: true,
    activeSessionId: 'sess_agrovet_03',
    deviceSessions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 4. Buyer: Amina Hassan (Nairobi)
  const buyerUser: User = {
    id: 'usr_buyer_nairobi_04',
    email: 'amina.buyer@gmail.com',
    phone: '+254744556677',
    fullName: 'Amina Hassan',
    role: 'buyer',
    passwordHash,
    location: {
      lat: -1.2635,
      lng: 36.8024,
      county: 'Nairobi',
      town: 'Westlands',
      address: 'Mpaka Road, Apartment 4B',
    },
    isPhoneVerified: true,
    isEmailVerified: true,
    activeSessionId: 'sess_buyer_04',
    deviceSessions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 5. Admin: System Operations
  const adminUser: User = {
    id: 'usr_admin_05',
    email: 'admin@farmersworld.co.ke',
    phone: '+254700000001',
    fullName: 'FarmersWorld Compliance Officer',
    role: 'admin',
    passwordHash,
    payoutPasswordHash,
    location: {
      lat: -1.286389,
      lng: 36.817223,
      county: 'Nairobi',
      town: 'Nairobi CBD',
      address: 'Harambee Avenue',
    },
    isPhoneVerified: true,
    isEmailVerified: true,
    activeSessionId: 'sess_admin_05',
    deviceSessions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  [farmer1, farmer2, agrovetUser, buyerUser, adminUser].forEach((u) => mem.users.set(u.id, u));

  // Seed Agrovet License
  const agroLicense: AgrovetLicense = {
    id: 'lic_rift_valley_01',
    agrovetUserId: agrovetUser.id,
    businessName: 'Rift Valley Certified Agrovet Supplies',
    licenseNumber: 'KVB/AGRO/2026/0488',
    regulatoryBoard: 'Kenya Veterinary Board',
    certificateKey: 'licenses/kvb_cert_2026_0488.pdf',
    premiseAddress: 'Geoffrey Kamau Way, Shop #14, Nakuru',
    premiseLocation: agrovetUser.location,
    isVerified: true,
    verifiedAt: new Date().toISOString(),
    verifiedByAdminId: adminUser.id,
    createdAt: new Date().toISOString(),
  };
  mem.agrovetLicenses.set(agroLicense.id, agroLicense);
  agrovetUser.agrovetLicenseId = agroLicense.id;

  // Seed Wallets
  mem.wallets.set('wal_farmer1', {
    id: 'wal_farmer1',
    userId: farmer1.id,
    currency: 'KES',
    availableBalance: 8450, // Available to withdraw
    lockedEscrowBalance: 1200,
    totalEarned: 15600,
    totalWithdrawn: 5950,
    updatedAt: new Date().toISOString(),
  });

  mem.wallets.set('wal_farmer2', {
    id: 'wal_farmer2',
    userId: farmer2.id,
    currency: 'KES',
    availableBalance: 4200,
    lockedEscrowBalance: 0,
    totalEarned: 4200,
    totalWithdrawn: 0,
    updatedAt: new Date().toISOString(),
  });

  mem.wallets.set('wal_agrovet', {
    id: 'wal_agrovet',
    userId: agrovetUser.id,
    currency: 'KES',
    availableBalance: 24500,
    lockedEscrowBalance: 3200,
    totalEarned: 42000,
    totalWithdrawn: 14300,
    updatedAt: new Date().toISOString(),
  });

  // Seed Products with Dynamic Category Acceptance Thresholds & Stocks
  const products: Product[] = [
    {
      id: 'prod_sukuma_kiambu_01',
      sellerId: farmer1.id,
      sellerRole: 'farmer',
      categoryId: 'cat_veg_01',
      categorySlug: 'fresh-vegetables',
      title: 'Fresh Organic Sukuma Wiki (Collard Greens)',
      description: 'Crisp organic sukuma wiki harvested at dawn. Sold in 10kg bunches or 50kg sacks.',
      pricePerUnit: 25, // KES 25 per bunch
      unit: 'bunch',
      stockQuantity: 300,
      minOrderQuantity: 2,
      mediaKeys: ['products/sukuma_wiki_kiambu_fresh.jpg'],
      location: farmer1.location,
      isAvailable: true,
      perishable: true,
      acceptanceTimeoutMinutes: 30, // 30 min threshold for perishable vegetables
      tags: ['sukuma', 'greens', 'collard', 'organic', 'vegetables'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'prod_tomatoes_kiambu_02',
      sellerId: farmer1.id,
      sellerRole: 'farmer',
      categoryId: 'cat_veg_01',
      categorySlug: 'fresh-vegetables',
      title: 'Ripe Anna F1 Greenhouse Tomatoes',
      description: 'Firm greenhouse-grown tomatoes with long shelf life. Excellent for markets, restaurants, and homes.',
      pricePerUnit: 90,
      unit: 'kg',
      stockQuantity: 80,
      minOrderQuantity: 1,
      mediaKeys: ['products/anna_tomatoes_fresh.jpg'],
      location: farmer1.location,
      isAvailable: true,
      perishable: true,
      acceptanceTimeoutMinutes: 30,
      tags: ['tomatoes', 'anna f1', 'greenhouse', 'vegetables'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'prod_sukuma_limuru_03',
      sellerId: farmer2.id,
      sellerRole: 'farmer',
      categoryId: 'cat_veg_01',
      categorySlug: 'fresh-vegetables',
      title: 'Highland Farm Sukuma Wiki (Collards)',
      description: 'Grown on cool Limuru highlands, tender leaves rich in nutrients.',
      pricePerUnit: 24, // Alternative seller for auto-reroute
      unit: 'bunch',
      stockQuantity: 250,
      minOrderQuantity: 2,
      mediaKeys: ['products/sukuma_limuru_cool.jpg'],
      location: farmer2.location,
      isAvailable: true,
      perishable: true,
      acceptanceTimeoutMinutes: 30,
      tags: ['sukuma', 'greens', 'limuru', 'vegetables'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'prod_potatoes_limuru_04',
      sellerId: farmer2.id,
      sellerRole: 'farmer',
      categoryId: 'cat_tubers_05',
      categorySlug: 'root-tubers',
      title: 'Shangi Red Irish Potatoes',
      description: 'Freshly harvested Shangi variety Irish potatoes. Ideal for chips, crisps, and boiling.',
      pricePerUnit: 60,
      unit: 'kg',
      stockQuantity: 500,
      minOrderQuantity: 5,
      mediaKeys: ['products/shangi_potatoes_limuru.jpg'],
      location: farmer2.location,
      isAvailable: true,
      perishable: false,
      acceptanceTimeoutMinutes: 360,
      tags: ['potatoes', 'shangi', 'waru', 'tubers'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'prod_seeds_agrovet_05',
      sellerId: agrovetUser.id,
      sellerRole: 'agrovet',
      categoryId: 'cat_agrovet_seeds_06',
      categorySlug: 'certified-seeds',
      title: 'Kenya Seed H6213 Hybrid Maize Seed (2kg Packet)',
      description: 'KePHIS certified high-altitude hybrid maize seed. High yield potential (35-42 bags/acre).',
      pricePerUnit: 580,
      unit: '2kg_packet',
      stockQuantity: 120,
      minOrderQuantity: 1,
      mediaKeys: ['products/kephis_h6213_maize_seed.jpg'],
      location: agrovetUser.location,
      isAvailable: true,
      perishable: false,
      acceptanceTimeoutMinutes: 1440, // 24 hours
      tags: ['certified seeds', 'maize', 'kephis', 'agrovet', 'hybrid'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'prod_fertilizer_agrovet_06',
      sellerId: agrovetUser.id,
      sellerRole: 'agrovet',
      categoryId: 'cat_agrovet_fertilizers_07',
      categorySlug: 'fertilizers-nutrients',
      title: 'Baraka DAP Planting Fertilizer (50kg Bag)',
      description: 'High phosphorus planting fertilizer 18:46:0 for strong root establishment.',
      pricePerUnit: 4800,
      unit: 'bag_50kg',
      stockQuantity: 40,
      minOrderQuantity: 1,
      mediaKeys: ['products/baraka_dap_fertilizer_50kg.jpg'],
      location: agrovetUser.location,
      isAvailable: true,
      perishable: false,
      acceptanceTimeoutMinutes: 1440,
      tags: ['fertilizer', 'dap', 'planting', 'agrovet'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  products.forEach((p) => mem.products.set(p.id, p));

  // Seed baseline order for instant tracking, receipt QR code, and rating demonstration
  const sampleNow = new Date().toISOString();
  const sampleOrder: import('./types/index.ts').Order = {
    id: 'ord_sample',
    buyerId: buyerUser.id,
    buyerLocation: buyerUser.location,
    deliveryAddress: 'Westlands, Mpaka Road, Nairobi',
    buyerUrgencyNotes: 'Fresh morning harvest delivery',
    vendorOrders: [
      {
        subOrderId: 'sub_sample',
        vendorId: farmer1.id,
        vendorRole: 'farmer',
        vendorLocation: farmer1.location,
        items: [
          {
            productId: 'prod_sukuma_kiambu_01',
            title: 'Fresh Organic Sukuma Wiki (Collard Greens)',
            quantity: 4,
            unitPrice: 25,
            subtotal: 100,
            unit: 'bunch',
          },
        ],
        subtotal: 100,
        status: 'in_transit',
        statusHistory: [
          {
            status: 'draft',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            note: 'Order created',
            updatedBy: 'buyer',
          },
          {
            status: 'paid',
            timestamp: new Date(Date.now() - 3000000).toISOString(),
            note: 'Paid via PawaPay. Funds held in escrow.',
            updatedBy: 'gateway',
          },
          {
            status: 'accepted',
            timestamp: new Date(Date.now() - 2400000).toISOString(),
            note: 'Farmer accepted order',
            updatedBy: 'farmer',
          },
          {
            status: 'in_transit',
            timestamp: sampleNow,
            lat: -1.272,
            lng: 36.815,
            note: 'Courier in transit with produce',
            updatedBy: 'courier',
          },
        ],
        liveGps: {
          lat: -1.272,
          lng: 36.815,
          speedKmh: 38,
          heading: 140,
          courierName: 'Kariuki Boda Logistics',
          courierPhone: '+254711223344',
          lastPingAt: sampleNow,
          estimatedArrivalMinutes: 8,
        },
        acceptanceExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        rerouteHistory: [],
      },
    ],
    totalAmount: 100,
    deliveryFee: 188,
    grandTotal: 288,
    paymentGateway: 'pawapay',
    paymentReference: 'PAWA_MPESA_SMPL9921',
    status: 'dispatched',
    paymentStatus: 'paid',
    escrowStatus: 'locked',
    statusHistory: [
      {
        status: 'draft',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        note: 'Order drafted',
        updatedBy: 'buyer',
      },
      {
        status: 'paid',
        timestamp: new Date(Date.now() - 3000000).toISOString(),
        note: 'Payment confirmed. Escrow secured.',
        updatedBy: 'gateway',
      },
      {
        status: 'in_transit',
        timestamp: sampleNow,
        note: 'Dispatched and on delivery route',
        updatedBy: 'courier',
      },
    ],
    deliveryAckCode: '582194',
    isSingleVendorOrder: true,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: sampleNow,
  };

  mem.orders.set(sampleOrder.id, sampleOrder);

  // Initialize Durable Object live state for sample order
  import('./durable-objects/order-tracker.do.ts').then(({ getOrCreateOrderTracker }) => {
    const tracker = getOrCreateOrderTracker(sampleOrder.id);
    tracker.fetch(
      new Request('http://internal/gps-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: sampleOrder.id,
          subOrderId: 'sub_sample',
          lat: -1.272,
          lng: 36.815,
          speedKmh: 38,
          heading: 140,
          courierName: 'Kariuki Boda Logistics',
          courierPhone: '+254711223344',
          estimatedArrivalMinutes: 8,
        }),
      })
    );
  });
}
