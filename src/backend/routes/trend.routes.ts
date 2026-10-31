/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { cfCacheService } from '../services/cache.service.ts';
import { cfAnalyticsService } from '../services/analytics.service.ts';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.ts';
import { submitMarketPriceSchema } from '../validators/schemas.ts';
import type { PriceTrend } from '../types/index.ts';

const trendApp = new Hono();

/**
 * Get real-time regional commodity price trends (Cached with Cloudflare Cache)
 */
trendApp.get('/', async (c) => {
  const county = c.req.query('county');
  const categorySlug = c.req.query('category');
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
  let trends = Array.from(mem.priceTrends.values());

  if (county) {
    trends = trends.filter((t) => t.county.toLowerCase() === county.toLowerCase());
  }

  if (categorySlug) {
    trends = trends.filter((t) => t.categorySlug === categorySlug);
  }

  const responsePayload = JSON.stringify({
    success: true,
    totalRecords: trends.length,
    trends,
  });

  // Cache for 180 seconds (3 mins)
  cfCacheService.put(cacheKey, responsePayload, 180, {
    tag: 'price_trends',
    contentType: 'application/json',
  });

  cfAnalyticsService.logEvent({
    eventType: 'price_trend_view',
    county,
    categorySlug,
  });

  c.header('Cache-Control', 'public, max-age=180');
  c.header('CF-Cache-Status', 'MISS');
  return c.body(responsePayload);
});

/**
 * Submit or update commodity market price report (Farmers, Agrovets, Admins)
 */
trendApp.post('/', authMiddleware, requireRole('farmer', 'agrovet', 'admin'), async (c) => {
  const body = await c.req.json();
  const parsed = submitMarketPriceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const trendId = `trend_${crypto.randomBytes(6).toString('hex')}`;
  const newTrend: PriceTrend = {
    id: trendId,
    ...parsed.data,
    recordedAt: new Date().toISOString(),
  };

  dbManager.inMemory.priceTrends.set(newTrend.id, newTrend);
  cfCacheService.invalidateByTag('price_trends');

  return c.json({ success: true, message: 'Market price trend recorded', trend: newTrend }, 201);
});

export default trendApp;
