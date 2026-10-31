/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AnalyticsEvent {
  dataset: string;
  blobs: string[]; // [eventType, county, categorySlug, userRole]
  doubles: number[]; // [amountKES, distanceKm, latencyMs]
  timestamp: string;
}

export class CloudflareAnalyticsService {
  private events: AnalyticsEvent[] = [];
  private datasetName: string;

  constructor() {
    this.datasetName = process.env.CF_ANALYTICS_DATASET || 'marketplace_events';
  }

  /**
   * Records an event conforming to Cloudflare Analytics Engine structure
   */
  logEvent(data: {
    eventType: 'search' | 'order_created' | 'order_delivered' | 'withdrawal' | 'price_trend_view' | 'sub_order_reroute';
    county?: string;
    categorySlug?: string;
    userRole?: string;
    amountKES?: number;
    distanceKm?: number;
    latencyMs?: number;
  }) {
    const event: AnalyticsEvent = {
      dataset: this.datasetName,
      blobs: [
        data.eventType,
        data.county || 'all_counties',
        data.categorySlug || 'general',
        data.userRole || 'anonymous',
      ],
      doubles: [data.amountKES || 0, data.distanceKm || 0, data.latencyMs || 0],
      timestamp: new Date().toISOString(),
    };

    this.events.push(event);

    // Keep sliding memory buffer for inspection
    if (this.events.length > 500) {
      this.events.shift();
    }
  }

  /**
   * Summarizes analytics for admin dashboard
   */
  getSummary() {
    const eventCounts: Record<string, number> = {};
    let totalVolumeKES = 0;
    let totalDistanceKm = 0;

    for (const ev of this.events) {
      const type = ev.blobs[0];
      eventCounts[type] = (eventCounts[type] || 0) + 1;
      totalVolumeKES += ev.doubles[0];
      totalDistanceKm += ev.doubles[1];
    }

    return {
      dataset: this.datasetName,
      totalRecordedEvents: this.events.length,
      eventBreakdown: eventCounts,
      totalVolumeKES: Math.round(totalVolumeKES),
      averageDeliveryDistanceKm: this.events.length > 0 ? Math.round(totalDistanceKm / this.events.length) : 0,
      recentEvents: this.events.slice(-20).reverse(),
    };
  }
}

export const cfAnalyticsService = new CloudflareAnalyticsService();
