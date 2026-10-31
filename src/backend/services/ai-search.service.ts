/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Product } from '../types/index.ts';

export class AiSearchService {
  /**
   * Performs semantic & fuzzy agricultural search
   * Supports Kenyan agricultural vocabulary (e.g. 'sukuma', 'kienyeji', 'managu', 'dhania', 'ndengu', 'shangi')
   */
  searchProducts(
    products: Product[],
    query: string,
    options: {
      categorySlug?: string;
      maxPrice?: number;
      county?: string;
    } = {}
  ): { product: Product; relevanceScore: number; matchReasons: string[] }[] {
    const cleanQ = query.trim().toLowerCase();
    const queryTokens = cleanQ.split(/\s+/).filter(Boolean);

    // Common agricultural synonyms mapping
    const synonymMap: Record<string, string[]> = {
      greens: ['sukuma', 'spinach', 'kale', 'managu', 'terere', 'cabbage'],
      vegetable: ['sukuma', 'spinach', 'cabbage', 'tomato', 'onion', 'carrot'],
      chicken: ['kienyeji', 'poultry', 'broiler', 'layers', 'cock', 'hen'],
      kuku: ['chicken', 'kienyeji', 'poultry', 'broiler', 'cock'],
      eggs: ['mayai', 'kienyeji eggs', 'tray', 'poultry'],
      mayai: ['eggs', 'kienyeji eggs', 'poultry'],
      potatoes: ['irish', 'shangi', 'waru', 'tubers'],
      waru: ['potatoes', 'irish', 'shangi', 'tubers'],
      ndengu: ['green grams', 'grams', 'cereals'],
      fertilizer: ['dap', 'can', 'urea', 'foliar', 'npk', 'agrovet'],
      seeds: ['hybrid', 'certified', 'kephis', 'seedlings', 'agrovet'],
      feeds: ['dairy meal', 'mash', 'concentrates', 'bran', 'silage'],
    };

    // Expand search query with synonyms
    const expandedTokens = new Set<string>(queryTokens);
    for (const token of queryTokens) {
      if (synonymMap[token]) {
        synonymMap[token].forEach((syn) => expandedTokens.add(syn));
      }
    }

    const results = products
      .filter((p) => p.isAvailable && p.stockQuantity > 0)
      .filter((p) => !options.categorySlug || p.categorySlug === options.categorySlug)
      .filter((p) => !options.maxPrice || p.pricePerUnit <= options.maxPrice)
      .filter((p) => !options.county || p.location.county.toLowerCase() === options.county.toLowerCase())
      .map((p) => {
        let score = 0;
        const reasons: string[] = [];

        const titleLower = p.title.toLowerCase();
        const descLower = p.description.toLowerCase();
        const categoryLower = p.categorySlug.toLowerCase();
        const tagsLower = p.tags.map((t) => t.toLowerCase());

        // Exact match
        if (titleLower.includes(cleanQ)) {
          score += 50;
          reasons.push('Title exact phrase match');
        }

        // Expanded token matches
        for (const token of expandedTokens) {
          if (titleLower.includes(token)) {
            score += 25;
            reasons.push(`Title matches term "${token}"`);
          }
          if (tagsLower.some((t) => t.includes(token))) {
            score += 20;
            reasons.push(`Tag matches "${token}"`);
          }
          if (descLower.includes(token)) {
            score += 10;
            reasons.push(`Description matches "${token}"`);
          }
          if (categoryLower.includes(token)) {
            score += 15;
            reasons.push(`Category match`);
          }
        }

        // Freshness/perishable logistics score bonus
        if (p.perishable) {
          score += 5;
        }

        return {
          product: p,
          relevanceScore: score,
          matchReasons: Array.from(new Set(reasons)),
        };
      })
      .filter((res) => (cleanQ ? res.relevanceScore > 0 : true))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results;
  }
}

export const aiSearchService = new AiSearchService();
