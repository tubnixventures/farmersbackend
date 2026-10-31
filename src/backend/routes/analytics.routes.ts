/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { dbManager } from '../db/mongo.ts';
import { cfAnalyticsService } from '../services/analytics.service.ts';
import { cfCacheService } from '../services/cache.service.ts';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.ts';
import type { AppEnv } from '../types/hono.ts';

const analyticsApp = new Hono<AppEnv>();

/**
 * Cloudflare Analytics Engine Telemetry Summary
 */
analyticsApp.get('/summary', async (c) => {
  const summary = cfAnalyticsService.getSummary();
  return c.json({ success: true, analytics: summary });
});

/**
 * Cloudflare Cache Hit Rate Telemetry (Target: >70% cache hit)
 */
analyticsApp.get('/cache-stats', async (c) => {
  const stats = cfCacheService.getStats();
  return c.json({ success: true, cache: stats });
});

/**
 * Administrative Audit Logs (Financial & Security Integrity)
 */
analyticsApp.get('/audit-logs', authMiddleware, requireRole('admin'), async (c) => {
  const mem = dbManager.inMemory;
  const logs = Array.from(mem.auditLogs.values()).reverse();
  return c.json({ success: true, count: logs.length, auditLogs: logs });
});

export default analyticsApp;
