/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface CacheEntry {
  body: string;
  contentType: string;
  headers: Record<string, string>;
  expiresAt: number;
  tag?: string;
}

export class CloudflareCacheService {
  private memoryCache = new Map<string, CacheEntry>();
  private totalRequests = 0;
  private hits = 0;
  private misses = 0;

  /**
   * Retrieves an item from the cache
   */
  get(url: string): { body: string; contentType: string; headers: Record<string, string> } | null {
    this.totalRequests++;
    const entry = this.memoryCache.get(url);

    if (entry && entry.expiresAt > Date.now()) {
      this.hits++;
      return {
        body: entry.body,
        contentType: entry.contentType,
        headers: {
          ...entry.headers,
          'CF-Cache-Status': 'HIT',
          'X-Cache-Provider': 'Cloudflare-Edge-Cache',
        },
      };
    }

    if (entry && entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(url);
    }

    this.misses++;
    return null;
  }

  /**
   * Caches an item for a given TTL in seconds
   */
  put(
    url: string,
    body: string,
    ttlSeconds: number,
    options: { contentType?: string; tag?: string; headers?: Record<string, string> } = {}
  ) {
    this.memoryCache.set(url, {
      body,
      contentType: options.contentType || 'application/json',
      headers: {
        ...(options.headers || {}),
        'Cache-Control': `public, max-age=${ttlSeconds}, stale-while-revalidate=60`,
        'CF-Cache-Status': 'MISS',
      },
      expiresAt: Date.now() + ttlSeconds * 1000,
      tag: options.tag,
    });
  }

  /**
   * Invalidates cache by tag (e.g. when an admin updates a category or farmer updates price)
   */
  invalidateByTag(tag: string): number {
    let count = 0;
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.tag === tag) {
        this.memoryCache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Returns current cache telemetry to verify >70% cache hit goal
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total === 0 ? 0 : Math.round((this.hits / total) * 100);
    return {
      totalRequests: this.totalRequests,
      hits: this.hits,
      misses: this.misses,
      hitRatePercentage: hitRate,
      activeEntries: this.memoryCache.size,
      targetHitRatePercentage: 70,
      meets70PercentTarget: hitRate >= 70,
    };
  }
}

export const cfCacheService = new CloudflareCacheService();
