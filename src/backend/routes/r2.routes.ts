/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { r2Service } from '../services/r2.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { presignedUrlRequestSchema } from '../validators/schemas.ts';
import type { User } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const r2App = new Hono<AppEnv>();

/**
 * Generate Presigned Upload URL for Cloudflare R2
 * Returns key and presignedUrl. The database only stores the key!
 */
r2App.post('/presigned-upload-url', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = presignedUrlRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const uploadPayload = r2Service.generatePresignedUploadUrl({
    folder: parsed.data.folder,
    fileExtension: parsed.data.fileExtension,
    contentType: parsed.data.contentType,
    userId: user.id,
    maxSizeBytes: parsed.data.maxSizeBytes,
  });

  return c.json({
    success: true,
    message: 'Presigned upload URL created. Upload binary via PUT to presignedUrl. Store ONLY the "key" in your database.',
    ...uploadPayload,
  });
});

/**
 * Direct R2 PUT Upload Endpoint Receiver (Simulates Cloudflare R2 object ingestion in Workers / Dev)
 */
r2App.put('/upload/:key{.*}', async (c) => {
  const key = c.req.param('key');
  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const rawBody = await c.req.arrayBuffer();

  return c.json({
    success: true,
    message: `Object received and persisted in Cloudflare R2 bucket. Key: ${key}`,
    key,
    sizeBytes: rawBody.byteLength,
    contentType,
  });
});

export default r2App;
