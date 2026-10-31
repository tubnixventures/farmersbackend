/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';

export interface PresignedUploadResponse {
  key: string;
  presignedUrl: string;
  uploadMethod: 'PUT';
  headers: Record<string, string>;
  maxSizeBytes: number;
  expiresInSeconds: number;
  publicUrlPreview: string; // for display only, DB only stores key
}

export class R2StorageService {
  private bucketName: string;
  private publicDomain: string;

  constructor() {
    this.bucketName = process.env.R2_BUCKET_NAME || 'farmersworld-media';
    this.publicDomain = process.env.R2_PUBLIC_DOMAIN || 'media.farmersworld.co.ke';
  }

  /**
   * Generates a secure presigned upload URL for Cloudflare R2
   * Returns key and presignedUrl. The database only persists the key.
   */
  generatePresignedUploadUrl(options: {
    folder: 'products' | 'licenses' | 'tickets' | 'receipts' | 'avatars';
    fileExtension: string;
    contentType: string;
    userId: string;
    maxSizeBytes?: number;
  }): PresignedUploadResponse {
    const { folder, fileExtension, contentType, userId, maxSizeBytes = 10 * 1024 * 1024 } = options;
    const cleanExt = fileExtension.replace(/^\./, '').toLowerCase();
    const uniqueId = crypto.randomBytes(12).toString('hex');
    const timestamp = Date.now();
    
    // Strict storage key format: e.g. "products/u_user123_1730000000_a1b2c3d4.jpg"
    const key = `${folder}/u_${userId.slice(-6)}_${timestamp}_${uniqueId}.${cleanExt}`;

    // Cloudflare R2 presigned PUT upload URL with signature
    const expiresSeconds = 900; // 15 minutes window
    const signature = crypto
      .createHmac('sha256', process.env.R2_SECRET_ACCESS_KEY || 'farmersworld-r2-secret-2026')
      .update(`${key}:${expiresSeconds}:${timestamp}`)
      .digest('hex');

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    // Emulated S3/R2 presigned upload endpoint on Workers / Express
    const presignedUrl = `${appUrl}/api/r2/upload/${encodeURIComponent(key)}?expires=${timestamp + expiresSeconds * 1000}&sig=${signature}`;

    return {
      key,
      presignedUrl,
      uploadMethod: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-amz-server-side-encryption': 'AES256',
      },
      maxSizeBytes,
      expiresInSeconds: expiresSeconds,
      publicUrlPreview: `https://${this.publicDomain}/${key}`,
    };
  }

  /**
   * Resolves public media URL from stored key
   */
  resolvePublicMediaUrl(key: string): string {
    if (!key) return '';
    return `https://${this.publicDomain}/${key}`;
  }
}

export const r2Service = new R2StorageService();
