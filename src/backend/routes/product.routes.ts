/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { cfCacheService } from '../services/cache.service.ts';
import { cfAnalyticsService } from '../services/analytics.service.ts';
import { aiSearchService } from '../services/ai-search.service.ts';
import { rankProductsByProximityAndPrice } from '../services/geo.service.ts';
import {
  authMiddleware,
  requireRole,
  requireFarmerSubscription,
  requireVerifiedAgrovet,
} from '../middleware/auth.middleware.ts';
import { createProductSchema, updateProductSchema, updateStockSchema } from '../validators/schemas.ts';
import type { Product, User } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const productApp = new Hono<AppEnv>();

/**
 * List products with filtering and Cloudflare Cache
 */
productApp.get('/', async (c) => {
  const categorySlug = c.req.query('category');
  const county = c.req.query('county');
  const cacheKey = c.req.url;

  const cached = cfCacheService.get(cacheKey);
  if (cached) {
    c.header('Content-Type', cached.contentType);
    for (const [k, v] of Object.entries(cached.headers)) {
      c.header(k, v);
    }
    return c.body(cached.body);
  }

  const mem = dbManager.inMemory;
  let products = Array.from(mem.products.values()).filter((p) => p.isAvailable && p.stockQuantity > 0);

  if (categorySlug) {
    products = products.filter((p) => p.categorySlug === categorySlug);
  }

  if (county) {
    products = products.filter((p) => p.location.county.toLowerCase() === county.toLowerCase());
  }

  const responsePayload = JSON.stringify({
    success: true,
    total: products.length,
    products,
  });

  // Cache for 60 seconds
  cfCacheService.put(cacheKey, responsePayload, 60, {
    tag: 'products',
    contentType: 'application/json',
  });

  cfAnalyticsService.logEvent({
    eventType: 'search',
    county,
    categorySlug,
  });

  c.header('Cache-Control', 'public, max-age=60');
  c.header('CF-Cache-Status', 'MISS');
  return c.body(responsePayload);
});

/**
 * Geolocation Search using Haversine formula:
 * Disallows or flags unreasonable distances for perishable greens (e.g. 20 KES sukuma from 50km)
 * Allows sorting by proximity, cheapest price, or composite value score.
 */
productApp.get('/nearby', async (c) => {
  const lat = parseFloat(c.req.query('lat') || '0');
  const lng = parseFloat(c.req.query('lng') || '0');
  const maxDistanceKm = c.req.query('maxDistanceKm') ? parseFloat(c.req.query('maxDistanceKm')!) : undefined;
  const sortBy = (c.req.query('sortBy') as 'distance' | 'price' | 'value_score') || 'distance';
  const categorySlug = c.req.query('category');

  if (!lat || !lng) {
    return c.json(
      {
        success: false,
        error: 'Buyer latitude and longitude query parameters are required for Haversine proximity routing.',
      },
      400
    );
  }

  const allProducts = Array.from(dbManager.inMemory.products.values());
  const ranked = rankProductsByProximityAndPrice(allProducts, { lat, lng }, {
    maxDistanceKm,
    sortBy,
    categorySlug,
  });

  cfAnalyticsService.logEvent({
    eventType: 'search',
    distanceKm: ranked[0]?.distanceKm || 0,
  });

  return c.json({
    success: true,
    buyerCoordinates: { lat, lng },
    sortBy,
    totalMatches: ranked.length,
    results: ranked,
  });
});

/**
 * Cloudflare AI Semantic Search with Agricultural Ontology
 */
productApp.get('/ai-search', async (c) => {
  const q = c.req.query('q') || '';
  const categorySlug = c.req.query('category');
  const maxPrice = c.req.query('maxPrice') ? parseFloat(c.req.query('maxPrice')!) : undefined;
  const county = c.req.query('county');

  const allProducts = Array.from(dbManager.inMemory.products.values());
  const searchResults = aiSearchService.searchProducts(allProducts, q, {
    categorySlug,
    maxPrice,
    county,
  });

  return c.json({
    success: true,
    query: q,
    resultsCount: searchResults.length,
    results: searchResults,
  });
});

/**
 * Get product by ID
 */
productApp.get('/:id', async (c) => {
  const id = c.req.param('id')!;
  const prod = dbManager.inMemory.products.get(id);

  if (!prod) {
    return c.json({ success: false, error: 'Product not found' }, 404);
  }

  return c.json({ success: true, product: prod });
});

/**
 * Create product: Requires Farmer (with active subscription or free trial) or Agrovet (with approved license)
 */
productApp.post(
  '/',
  authMiddleware,
  requireRole('farmer', 'agrovet'),
  requireFarmerSubscription,
  requireVerifiedAgrovet,
  async (c) => {
    const user = c.get('user') as User;
    const body = await c.req.json();
    const parsed = createProductSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
    }

    const mem = dbManager.inMemory;
    const category = mem.categories.get(parsed.data.categoryId);
    if (!category) {
      return c.json({ success: false, error: 'Specified category does not exist' }, 400);
    }

    const productId = `prod_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();

    const newProduct: Product = {
      id: productId,
      sellerId: user.id,
      sellerRole: user.role === 'agrovet' ? 'agrovet' : 'farmer',
      categoryId: category.id,
      categorySlug: category.slug,
      title: parsed.data.title,
      description: parsed.data.description,
      pricePerUnit: parsed.data.pricePerUnit,
      unit: parsed.data.unit,
      stockQuantity: parsed.data.stockQuantity,
      minOrderQuantity: parsed.data.minOrderQuantity,
      mediaKeys: parsed.data.mediaKeys,
      location: parsed.data.location || user.location,
      isAvailable: true,
      perishable: parsed.data.perishable ?? category.isPerishable,
      acceptanceTimeoutMinutes: parsed.data.acceptanceTimeoutMinutes || category.defaultAcceptanceTimeoutMinutes,
      tags: parsed.data.tags,
      createdAt: now,
      updatedAt: now,
    };

    mem.products.set(newProduct.id, newProduct);
    cfCacheService.invalidateByTag('products');

    return c.json({ success: true, message: 'Product published successfully', product: newProduct }, 201);
  }
);

/**
 * Update product
 */
productApp.put('/:id', authMiddleware, requireRole('farmer', 'agrovet', 'admin'), async (c) => {
  const user = c.get('user') as User;
  const id = c.req.param('id')!;
  const mem = dbManager.inMemory;
  const prod = mem.products.get(id);

  if (!prod) return c.json({ success: false, error: 'Product not found' }, 404);

  if (user.role !== 'admin' && prod.sellerId !== user.id) {
    return c.json({ success: false, error: 'Forbidden: You cannot edit another vendor’s product' }, 403);
  }

  const body = await c.req.json();
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  Object.assign(prod, parsed.data);
  prod.updatedAt = new Date().toISOString();
  cfCacheService.invalidateByTag('products');

  return c.json({ success: true, message: 'Product updated', product: prod });
});

/**
 * Strict stock quantity update (prevents negative balances)
 */
productApp.patch('/:id/stock', authMiddleware, requireRole('farmer', 'agrovet', 'admin'), async (c) => {
  const user = c.get('user') as User;
  const id = c.req.param('id')!;
  const mem = dbManager.inMemory;
  const prod = mem.products.get(id);

  if (!prod) return c.json({ success: false, error: 'Product not found' }, 404);

  if (user.role !== 'admin' && prod.sellerId !== user.id) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const body = await c.req.json();
  const parsed = updateStockSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  prod.stockQuantity = parsed.data.stockQuantity;
  prod.updatedAt = new Date().toISOString();
  cfCacheService.invalidateByTag('products');

  return c.json({ success: true, message: 'Stock updated', product: prod });
});

/**
 * Delete product
 */
productApp.delete('/:id', authMiddleware, requireRole('farmer', 'agrovet', 'admin'), async (c) => {
  const user = c.get('user') as User;
  const id = c.req.param('id')!;
  const mem = dbManager.inMemory;
  const prod = mem.products.get(id);

  if (!prod) return c.json({ success: false, error: 'Product not found' }, 404);

  if (user.role !== 'admin' && prod.sellerId !== user.id) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  mem.products.delete(id);
  cfCacheService.invalidateByTag('products');

  return c.json({ success: true, message: 'Product removed' });
});

export default productApp;
