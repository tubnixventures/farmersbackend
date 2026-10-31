/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeoLocation, Product } from '../types/index.ts';

const EARTH_RADIUS_KM = 6371;

/**
 * Computes great-circle distance between two coordinates using the Haversine formula.
 * @param lat1 Latitude of point 1 in degrees
 * @param lon1 Longitude of point 1 in degrees
 * @param lat2 Latitude of point 2 in degrees
 * @param lon2 Longitude of point 2 in degrees
 * @returns Distance in kilometers
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (angle: number) => (angle * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

/**
 * Calculates delivery fee in KES based on Haversine distance
 */
export function calculateDeliveryFee(distanceKm: number, isBulk = false): number {
  if (distanceKm <= 1.0) return 40; // Flat local neighborhood fee (e.g. within village or estate)
  if (distanceKm <= 5.0) return Math.round(40 + distanceKm * 12);
  if (distanceKm <= 20.0) return Math.round(100 + (distanceKm - 5) * 15);
  // Regional / inter-county delivery fee
  const ratePerKm = isBulk ? 22 : 18;
  return Math.round(325 + (distanceKm - 20) * ratePerKm);
}

export interface NearbyProductMatch {
  product: Product;
  distanceKm: number;
  deliveryFeeKES: number;
  isWithinReasonableDistance: boolean;
}

/**
 * Filters and sorts products based on buyer's coordinates and preferences
 */
export function rankProductsByProximityAndPrice(
  products: Product[],
  buyerCoords: { lat: number; lng: number },
  options: {
    maxDistanceKm?: number;
    sortBy?: 'distance' | 'price' | 'value_score';
    categorySlug?: string;
  } = {}
): NearbyProductMatch[] {
  const { maxDistanceKm, sortBy = 'distance', categorySlug } = options;

  let list = products.filter((p) => p.isAvailable && p.stockQuantity > 0);

  if (categorySlug) {
    list = list.filter((p) => p.categorySlug === categorySlug);
  }

  const matches: NearbyProductMatch[] = list.map((product) => {
    const dist = calculateHaversineDistanceKm(
      buyerCoords.lat,
      buyerCoords.lng,
      product.location.lat,
      product.location.lng
    );

    // Perishable vegetables (like Sukuma wiki) should not ordinarily exceed reasonable distance (e.g., 20km)
    const maxReasonableKm = product.perishable ? 25 : 120;
    const isWithinReasonableDistance = dist <= maxReasonableKm;

    return {
      product,
      distanceKm: dist,
      deliveryFeeKES: calculateDeliveryFee(dist, product.unit.includes('bag') || product.unit.includes('crate')),
      isWithinReasonableDistance,
    };
  });

  // Filter by requested max distance if specified
  const filtered = maxDistanceKm ? matches.filter((m) => m.distanceKm <= maxDistanceKm) : matches;

  // Sorting strategy
  if (sortBy === 'distance') {
    return filtered.sort((a, b) => a.distanceKm - b.distanceKm);
  } else if (sortBy === 'price') {
    return filtered.sort((a, b) => a.product.pricePerUnit - b.product.pricePerUnit);
  } else {
    // Value score: balanced weighting between low price and low delivery distance
    return filtered.sort((a, b) => {
      const costA = a.product.pricePerUnit + a.deliveryFeeKES;
      const costB = b.product.pricePerUnit + b.deliveryFeeKES;
      return costA - costB;
    });
  }
}

/**
 * Finds the closest alternative qualified seller when an order sub-order is declined or times out
 */
export function findClosestAlternativeSeller(
  candidateProducts: Product[],
  declinedProduct: Product,
  requiredQuantity: number,
  buyerLocation: GeoLocation,
  excludedVendorIds: string[]
): { product: Product; distanceKm: number } | null {
  const eligible = candidateProducts.filter(
    (p) =>
      p.id !== declinedProduct.id &&
      !excludedVendorIds.includes(p.sellerId) &&
      p.categoryId === declinedProduct.categoryId &&
      p.stockQuantity >= requiredQuantity &&
      p.isAvailable
  );

  if (eligible.length === 0) return null;

  let bestMatch: { product: Product; distanceKm: number } | null = null;
  let minDistance = Infinity;

  for (const prod of eligible) {
    const dist = calculateHaversineDistanceKm(
      buyerLocation.lat,
      buyerLocation.lng,
      prod.location.lat,
      prod.location.lng
    );

    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = { product: prod, distanceKm: dist };
    }
  }

  return bestMatch;
}
