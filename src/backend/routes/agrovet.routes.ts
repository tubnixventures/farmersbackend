/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.ts';
import { submitLicenseSchema, verifyLicenseSchema } from '../validators/schemas.ts';
import type { User, AgrovetLicense } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const agrovetApp = new Hono<AppEnv>();

/**
 * Agrovet: Submit regulatory license for verification
 */
agrovetApp.post('/license/submit', authMiddleware, requireRole('agrovet'), async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = submitLicenseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const licenseId = `lic_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  const license: AgrovetLicense = {
    id: licenseId,
    agrovetUserId: user.id,
    businessName: parsed.data.businessName,
    licenseNumber: parsed.data.licenseNumber,
    regulatoryBoard: parsed.data.regulatoryBoard,
    certificateKey: parsed.data.certificateKey,
    premiseAddress: parsed.data.premiseAddress,
    premiseLocation: parsed.data.premiseLocation,
    isVerified: false,
    createdAt: now,
  };

  mem.agrovetLicenses.set(license.id, license);
  user.agrovetLicenseId = license.id;
  user.location = parsed.data.premiseLocation;
  user.updatedAt = now;

  return c.json(
    {
      success: true,
      message: 'Agrovet license submitted successfully. It will be verified by the platform admin before input sales are authorized.',
      license,
    },
    201
  );
});

/**
 * Agrovet: Get own license status
 */
agrovetApp.get('/license/my-license', authMiddleware, requireRole('agrovet'), async (c) => {
  const user = c.get('user') as User;
  const mem = dbManager.inMemory;
  const license = Array.from(mem.agrovetLicenses.values()).find((l) => l.agrovetUserId === user.id);

  if (!license) {
    return c.json({ success: false, message: 'No license submitted yet' }, 404);
  }

  return c.json({ success: true, license });
});

/**
 * Admin: List pending licenses
 */
agrovetApp.get('/licenses/pending', authMiddleware, requireRole('admin'), async (c) => {
  const mem = dbManager.inMemory;
  const pending = Array.from(mem.agrovetLicenses.values()).filter((l) => !l.isVerified);
  return c.json({ success: true, count: pending.length, licenses: pending });
});

/**
 * Admin: Verify or reject agrovet license
 */
agrovetApp.post('/licenses/:id/verify', authMiddleware, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const parsed = verifyLicenseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const license = mem.agrovetLicenses.get(id);
  if (!license) return c.json({ success: false, error: 'License record not found' }, 404);

  license.isVerified = parsed.data.approved;
  license.verifiedAt = parsed.data.approved ? new Date().toISOString() : undefined;
  license.verifiedByAdminId = admin.id;
  license.rejectionReason = parsed.data.approved ? undefined : parsed.data.rejectionReason;

  return c.json({
    success: true,
    message: parsed.data.approved ? 'Agrovet license approved.' : 'Agrovet license rejected.',
    license,
  });
});

/**
 * Public: Verified Agrovets directory
 */
agrovetApp.get('/directory', async (c) => {
  const mem = dbManager.inMemory;
  const verified = Array.from(mem.agrovetLicenses.values())
    .filter((l) => l.isVerified)
    .map((l) => ({
      businessName: l.businessName,
      licenseNumber: l.licenseNumber,
      regulatoryBoard: l.regulatoryBoard,
      premiseAddress: l.premiseAddress,
      premiseLocation: l.premiseLocation,
    }));

  return c.json({ success: true, count: verified.length, agrovets: verified });
});

export default agrovetApp;
