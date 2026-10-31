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
import { createBannerSchema, updateBannerSchema } from '../validators/schemas.ts';
import type { Banner, BannerPosition, UserRole } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const bannerApp = new Hono<AppEnv>();

/**
 * List active agricultural & promotional banners (Cached via Cloudflare Cache API)
 * Filters: position, county, role
 */
bannerApp.get('/', async (c) => {
  const position = c.req.query('position') as BannerPosition | undefined;
  const county = c.req.query('county');
  const role = c.req.query('role') as UserRole | undefined;
  const cacheKey = c.req.url;

  // Cloudflare Edge Cache lookup
  const cached = cfCacheService.get(cacheKey);
  if (cached) {
    c.header('Content-Type', cached.contentType);
    for (const [k, v] of Object.entries(cached.headers)) {
      c.header(k, v);
    }
    return c.body(cached.body);
  }

  const mem = dbManager.inMemory;
  const now = Date.now();

  let banners = Array.from(mem.banners.values()).filter((b) => {
    if (!b.isActive) return false;
    if (new Date(b.startDate).getTime() > now) return false;
    if (b.endDate && new Date(b.endDate).getTime() < now) return false;
    return true;
  });

  if (position) {
    banners = banners.filter((b) => b.position === position);
  }

  if (county && county.toLowerCase() !== 'all') {
    banners = banners.filter(
      (b) => b.targetCounty === 'All' || b.targetCounty?.toLowerCase() === county.toLowerCase()
    );
  }

  if (role) {
    banners = banners.filter((b) => b.targetRole === 'all' || b.targetRole === role);
  }

  // Sort by priority (1 is highest) then by creation date
  banners.sort((a, b) => a.priority - b.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Increment impression counters
  banners.forEach((b) => {
    b.impressionCount++;
  });

  const responsePayload = JSON.stringify({
    success: true,
    total: banners.length,
    banners,
  });

  // Cache for 120 seconds with tag 'banners'
  cfCacheService.put(cacheKey, responsePayload, 120, {
    tag: 'banners',
    contentType: 'application/json',
  });

  c.header('Cache-Control', 'public, max-age=120');
  c.header('CF-Cache-Status', 'MISS');
  return c.body(responsePayload);
});

/**
 * Get banner by ID
 */
bannerApp.get('/:id', async (c) => {
  const id = c.req.param('id')!;
  const banner = dbManager.inMemory.banners.get(id);

  if (!banner) {
    return c.json({ success: false, error: 'Banner not found' }, 404);
  }

  return c.json({ success: true, banner });
});

/**
 * Track banner click / engagement
 */
bannerApp.post('/:id/click', async (c) => {
  const id = c.req.param('id')!;
  const banner = dbManager.inMemory.banners.get(id);

  if (!banner) {
    return c.json({ success: false, error: 'Banner not found' }, 404);
  }

  banner.clickCount++;

  cfAnalyticsService.logEvent({
    eventType: 'search',
    county: banner.targetCounty,
    categorySlug: banner.position,
  });

  return c.json({
    success: true,
    message: 'Banner click recorded',
    clickCount: banner.clickCount,
    actionUrl: banner.actionUrl,
  });
});

/**
 * Admin: Create promotional or agronomic banner
 */
bannerApp.post('/', authMiddleware, requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const parsed = createBannerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const bannerId = `ban_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  const newBanner: Banner = {
    id: bannerId,
    title: parsed.data.title,
    subtitle: parsed.data.subtitle,
    imageKey: parsed.data.imageKey, // Stores R2 key only
    actionUrl: parsed.data.actionUrl,
    position: parsed.data.position,
    targetRole: parsed.data.targetRole,
    targetCounty: parsed.data.targetCounty,
    priority: parsed.data.priority,
    startDate: parsed.data.startDate || now,
    endDate: parsed.data.endDate,
    isActive: parsed.data.isActive ?? true,
    clickCount: 0,
    impressionCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  mem.banners.set(newBanner.id, newBanner);
  cfCacheService.invalidateByTag('banners');

  return c.json({ success: true, message: 'Banner created successfully', banner: newBanner }, 201);
});

/**
 * Admin: Update banner details
 */
bannerApp.put('/:id', authMiddleware, requireRole('admin'), async (c) => {
  const id = c.req.param('id')!;
  const mem = dbManager.inMemory;
  const banner = mem.banners.get(id);

  if (!banner) {
    return c.json({ success: false, error: 'Banner not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = updateBannerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  Object.assign(banner, parsed.data);
  banner.updatedAt = new Date().toISOString();
  cfCacheService.invalidateByTag('banners');

  return c.json({ success: true, message: 'Banner updated successfully', banner });
});

/**
 * Admin: Toggle banner status (active/inactive)
 */
bannerApp.patch('/:id/status', authMiddleware, requireRole('admin'), async (c) => {
  const id = c.req.param('id')!;
  const mem = dbManager.inMemory;
  const banner = mem.banners.get(id);

  if (!banner) {
    return c.json({ success: false, error: 'Banner not found' }, 404);
  }

  const { isActive } = (await c.req.json().catch(() => ({}))) as { isActive?: boolean };
  banner.isActive = isActive !== undefined ? isActive : !banner.isActive;
  banner.updatedAt = new Date().toISOString();
  cfCacheService.invalidateByTag('banners');

  return c.json({
    success: true,
    message: `Banner ${banner.isActive ? 'activated' : 'deactivated'}`,
    banner,
  });
});

/**
 * Admin: Delete banner
 */
bannerApp.delete('/:id', authMiddleware, requireRole('admin'), async (c) => {
  const id = c.req.param('id')!;
  const mem = dbManager.inMemory;

  if (!mem.banners.has(id)) {
    return c.json({ success: false, error: 'Banner not found' }, 404);
  }

  mem.banners.delete(id);
  cfCacheService.invalidateByTag('banners');

  return c.json({ success: true, message: 'Banner deleted successfully' });
});

export default bannerApp;
