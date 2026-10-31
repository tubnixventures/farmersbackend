/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MongoClient, Db } from 'mongodb';
import type {
  User,
  Product,
  Category,
  Order,
  Cart,
  Wallet,
  WalletTransaction,
  AgrovetLicense,
  PriceTrend,
  SupportTicket,
  AuditLog,
  OtpRecord,
} from '../types/index.ts';

// In-Memory Database Store (Initialized with standard Kenyan agricultural reference data)
class InMemoryStore {
  users: Map<string, User> = new Map();
  products: Map<string, Product> = new Map();
  categories: Map<string, Category> = new Map();
  orders: Map<string, Order> = new Map();
  carts: Map<string, Cart> = new Map();
  wallets: Map<string, Wallet> = new Map();
  transactions: Map<string, WalletTransaction> = new Map();
  agrovetLicenses: Map<string, AgrovetLicense> = new Map();
  priceTrends: Map<string, PriceTrend> = new Map();
  supportTickets: Map<string, SupportTicket> = new Map();
  auditLogs: Map<string, AuditLog> = new Map();
  otps: Map<string, OtpRecord> = new Map();
  ratings: Map<string, import('../types/index.ts').OrderRating> = new Map();
  banners: Map<string, import('../types/index.ts').Banner> = new Map();

  constructor() {
    this.seedDefaultData();
  }

  seedDefaultData() {
    // 1. Initial Categories with dynamic timeouts & commission rules
    const initialCategories: Category[] = [
      {
        id: 'cat_veg_01',
        name: 'Fresh Vegetables & Greens',
        slug: 'fresh-vegetables',
        description: 'Sukuma wiki, spinach, cabbage, tomatoes, onions, carrots direct from farms',
        isPerishable: true,
        defaultAcceptanceTimeoutMinutes: 30, // Perishable: 30 mins acceptance threshold
        commissionRatePercent: 2.0,
        isActive: true,
      },
      {
        id: 'cat_fruits_02',
        name: 'Fresh Fruits & Berries',
        slug: 'fresh-fruits',
        description: 'Avocados, bananas, mangoes, pineapples, watermelon',
        isPerishable: true,
        defaultAcceptanceTimeoutMinutes: 60,
        commissionRatePercent: 2.0,
        isActive: true,
      },
      {
        id: 'cat_poultry_03',
        name: 'Poultry & Fresh Eggs',
        slug: 'poultry-eggs',
        description: 'Kienyeji chicken, broilers, indigenous farm eggs, day-old chicks',
        isPerishable: true,
        defaultAcceptanceTimeoutMinutes: 120, // 2 hours
        commissionRatePercent: 2.5,
        isActive: true,
      },
      {
        id: 'cat_cereals_04',
        name: 'Cereals & Dry Grains',
        slug: 'cereals-grains',
        description: 'Maize, dry beans, green grams (ndengu), sorghum, millet, wheat',
        isPerishable: false,
        defaultAcceptanceTimeoutMinutes: 720, // 12 hours
        commissionRatePercent: 2.0,
        isActive: true,
      },
      {
        id: 'cat_tubers_05',
        name: 'Root Tubers',
        slug: 'root-tubers',
        description: 'Irish potatoes, sweet potatoes, cassava, arrowroots (nduma)',
        isPerishable: false,
        defaultAcceptanceTimeoutMinutes: 360,
        commissionRatePercent: 2.0,
        isActive: true,
      },
      {
        id: 'cat_agrovet_seeds_06',
        name: 'Agrovet: Certified Seeds & Seedlings',
        slug: 'certified-seeds',
        description: 'KePHIS certified hybrid maize seeds, certified vegetable seeds, grafted fruit seedlings',
        isPerishable: false,
        defaultAcceptanceTimeoutMinutes: 1440, // 24 hours
        commissionRatePercent: 5.0, // Agrovet platform commission 5%
        isActive: true,
      },
      {
        id: 'cat_agrovet_fertilizers_07',
        name: 'Agrovet: Fertilizers & Soil Nutrients',
        slug: 'fertilizers-nutrients',
        description: 'DAP, CAN, Urea, foliar sprays, organic compost and bio-fertilizers',
        isPerishable: false,
        defaultAcceptanceTimeoutMinutes: 1440,
        commissionRatePercent: 5.0,
        isActive: true,
      },
      {
        id: 'cat_agrovet_vet_08',
        name: 'Agrovet: Veterinary Products & Feeds',
        slug: 'veterinary-feeds',
        description: 'Dairy meal, poultry chick mash, dewormers, mineral salts, livestock vaccines',
        isPerishable: false,
        defaultAcceptanceTimeoutMinutes: 1440,
        commissionRatePercent: 5.5,
        isActive: true,
      },
    ];

    initialCategories.forEach((cat) => this.categories.set(cat.id, cat));

    // 2. Initial Sample Price Trends across key Kenyan agricultural hubs
    const initialTrends: PriceTrend[] = [
      {
        id: 'trend_sukuma_nairobi',
        commodityName: 'Sukuma Wiki (Collard Greens)',
        categorySlug: 'fresh-vegetables',
        county: 'Nairobi',
        marketName: 'Marikiti (Wakulima Market)',
        unit: '50kg Bag',
        wholesalePriceKES: 1400,
        retailPriceKES: 1800,
        minPriceKES: 1200,
        maxPriceKES: 2100,
        supplyLevel: 'normal',
        trendDirection: 'stable',
        recordedAt: new Date().toISOString(),
      },
      {
        id: 'trend_tomatoes_kiambu',
        commodityName: 'Fresh Tomatoes',
        categorySlug: 'fresh-vegetables',
        county: 'Kiambu',
        marketName: 'Wangige Market',
        unit: '64kg Wooden Crate',
        wholesalePriceKES: 4500,
        retailPriceKES: 5800,
        minPriceKES: 4000,
        maxPriceKES: 6200,
        supplyLevel: 'low',
        trendDirection: 'up',
        recordedAt: new Date().toISOString(),
      },
      {
        id: 'trend_dry_maize_eldoret',
        commodityName: 'Dry White Maize',
        categorySlug: 'cereals-grains',
        county: 'Uasin Gishu',
        marketName: 'Eldoret Wholesale Market',
        unit: '90kg Bag',
        wholesalePriceKES: 3200,
        retailPriceKES: 3600,
        minPriceKES: 3000,
        maxPriceKES: 3800,
        supplyLevel: 'high',
        trendDirection: 'down',
        recordedAt: new Date().toISOString(),
      },
      {
        id: 'trend_potatoes_nakuru',
        commodityName: 'Irish Potatoes (Shangi)',
        categorySlug: 'root-tubers',
        county: 'Nakuru',
        marketName: 'Nakuru Top Market',
        unit: '50kg Bag',
        wholesalePriceKES: 2600,
        retailPriceKES: 3100,
        minPriceKES: 2400,
        maxPriceKES: 3400,
        supplyLevel: 'normal',
        trendDirection: 'stable',
        recordedAt: new Date().toISOString(),
      },
      {
        id: 'trend_kienyeji_eggs_kisumu',
        commodityName: 'Kienyeji Farm Eggs',
        categorySlug: 'poultry-eggs',
        county: 'Kisumu',
        marketName: 'Kibuye Market',
        unit: 'Tray of 30',
        wholesalePriceKES: 450,
        retailPriceKES: 550,
        minPriceKES: 420,
        maxPriceKES: 600,
        supplyLevel: 'normal',
        trendDirection: 'up',
        recordedAt: new Date().toISOString(),
      },
    ];

    initialTrends.forEach((t) => this.priceTrends.set(t.id, t));

    // 3. Initial Agricultural Banners & County Bulletins
    const initialBanners: import('../types/index.ts').Banner[] = [
      {
        id: 'ban_planting_season_01',
        title: '🌱 Short Rains Planting Season: Certified Seeds Available',
        subtitle: 'Order KePHIS certified hybrid maize seeds and DAP fertilizer with free regional dispatch.',
        imageKey: 'banners/planting_season_kenya_2026.jpg',
        actionUrl: '/api/products?category=certified-seeds',
        position: 'home_hero',
        targetRole: 'all',
        targetCounty: 'All',
        priority: 1,
        startDate: new Date(Date.now() - 86400000).toISOString(),
        isActive: true,
        clickCount: 142,
        impressionCount: 1850,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ban_kiambu_farm_greens_02',
        title: '🥬 Kiambu Harvest Special: 100% Crisp Organic Sukuma Wiki',
        subtitle: 'Harvested fresh at dawn by verified smallholder farmers within 15km of Nairobi.',
        imageKey: 'banners/kiambu_sukuma_wiki_hero.jpg',
        actionUrl: '/api/products/nearby?lat=-1.2635&lng=36.8024&category=fresh-vegetables',
        position: 'category_header',
        targetRole: 'buyer',
        targetCounty: 'Nairobi',
        priority: 2,
        startDate: new Date(Date.now() - 86400000).toISOString(),
        isActive: true,
        clickCount: 89,
        impressionCount: 920,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ban_vet_pesticide_alert_03',
        title: '⚠️ Ministry of Agriculture Fall Armyworm Advisory',
        subtitle: 'Check verified agrovet listings in Nakuru and Uasin Gishu for PCPB approved bio-pesticides.',
        imageKey: 'banners/pcpb_pest_control_advisory.jpg',
        actionUrl: '/api/products?category=veterinary-feeds',
        position: 'popup_notice',
        targetRole: 'farmer',
        targetCounty: 'Nakuru',
        priority: 1,
        startDate: new Date().toISOString(),
        isActive: true,
        clickCount: 45,
        impressionCount: 610,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    initialBanners.forEach((b) => this.banners.set(b.id, b));
  }
}

class MongoDBManager {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  public inMemory = new InMemoryStore();
  public isConnectedToRemote = false;

  async init() {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || 'farmersworld';

    if (uri && uri.startsWith('mongodb')) {
      try {
        this.client = new MongoClient(uri, {
          serverSelectionTimeoutMS: 3000,
          connectTimeoutMS: 5000,
        });
        await this.client.connect();
        this.db = this.client.db(dbName);
        this.isConnectedToRemote = true;
        console.log(`[MongoDB] Connected successfully to remote database: ${dbName}`);
      } catch (err) {
        console.warn(`[MongoDB] Could not connect to remote MongoDB (${(err as Error).message}). Using high-performance in-memory repository.`);
        this.isConnectedToRemote = false;
      }
    } else {
      console.log('[MongoDB] MONGODB_URI not provided. Running in high-performance in-memory mode for development and edge testing.');
      this.isConnectedToRemote = false;
    }
  }

  getDb(): Db | null {
    return this.db;
  }
}

export const dbManager = new MongoDBManager();
