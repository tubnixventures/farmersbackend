/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { cfCacheService } from '../services/cache.service.ts';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.ts';
import { categorySchema } from '../validators/schemas.ts';
import type { Category } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const categoryApp = new Hono<AppEnv>();

/**
 * List categories (Backend controlled with Cloudflare Cache)
 */
categoryApp.get('/', async (c) => {
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
  const categories = Array.from(mem.categories.values()).filter((cat) => cat.isActive);

  const responsePayload = JSON.stringify({
    success: true,
    count: categories.length,
    categories,
  });

  // Cache for 300 seconds (5 mins) with tag 'categories'
  cfCacheService.put(cacheKey, responsePayload, 300, {
    tag: 'categories',
    contentType: 'application/json',
  });

  c.header('Cache-Control', 'public, max-age=300');
  c.header('CF-Cache-Status', 'MISS');
  return c.body(responsePayload);
});

/**
 * Get category by ID or slug
 */
categoryApp.get('/:idOrSlug', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const mem = dbManager.inMemory;

  const category =
    mem.categories.get(idOrSlug) ||
    Array.from(mem.categories.values()).find((cat) => cat.slug === idOrSlug);

  if (!category) {
    return c.json({ success: false, error: 'Category not found' }, 404);
  }

  return c.json({ success: true, category });
});

/**
 * Admin: Create category with dynamic acceptance timeout threshold and commission rate
 */
categoryApp.post('/', authMiddleware, requireRole('admin'), async (c) => {
  const body = await c.req.json();
  const parsed = categorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const categoryId = `cat_${crypto.randomBytes(6).toString('hex')}`;
  const newCat: Category = {
    id: categoryId,
    ...parsed.data,
  };

  dbManager.inMemory.categories.set(newCat.id, newCat);
  cfCacheService.invalidateByTag('categories');

  return c.json({ success: true, message: 'Category created', category: newCat }, 201);
});

/**
 * Admin: Update category & thresholds
 */
categoryApp.put('/:id', authMiddleware, requireRole('admin'), async (c) => {
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const cat = dbManager.inMemory.categories.get(id);

  if (!cat) {
    return c.json({ success: false, error: 'Category not found' }, 404);
  }

  const parsed = categorySchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  Object.assign(cat, parsed.data);
  cfCacheService.invalidateByTag('categories');

  return c.json({ success: true, message: 'Category updated', category: cat });
});

export default categoryApp;
