/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { authService, TokenPayload } from '../services/auth.service.ts';
import { dbManager } from '../db/mongo.ts';
import type { User, UserRole } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

/**
 * Cookie-based authentication middleware:
 * Extracts access_token & refresh_token exclusively from HttpOnly cookies.
 * Automatically handles token rotation and enforces single-device session integrity.
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const accessToken = getCookie(c, 'access_token');
  const refreshToken = getCookie(c, 'refresh_token');

  let payload = accessToken ? await authService.verifyToken(accessToken) : null;

  // If access token is expired or absent, attempt transparent refresh using 1-year refresh cookie
  if (!payload && refreshToken) {
    const refreshPayload = await authService.verifyToken(refreshToken);
    if (refreshPayload) {
      // Re-issue fresh 2-hour access token
      const newAccessToken = await authService.generateAccessToken({
        userId: refreshPayload.userId,
        role: refreshPayload.role,
        sessionId: refreshPayload.sessionId,
        email: refreshPayload.email,
      });

      // Write updated cookie
      setCookie(c, 'access_token', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 2 * 60 * 60, // 2 hours
        path: '/',
      });

      payload = refreshPayload;
    }
  }

  if (!payload) {
    return c.json(
      {
        success: false,
        error: 'Unauthorized',
        message: 'Valid authentication session cookie not found or expired. Please log in.',
      },
      401
    );
  }

  // Load user from database
  const user = dbManager.inMemory.users.get(payload.userId);
  if (!user) {
    return c.json({ success: false, error: 'User account no longer exists' }, 401);
  }

  // Single-Device Financial Gate: Ensure session is still active and not revoked by another device
  const activeSession = user.deviceSessions.find((s) => s.sessionId === payload!.sessionId);
  if (!activeSession || activeSession.isRevoked || user.activeSessionId !== payload.sessionId) {
    return c.json(
      {
        success: false,
        error: 'SessionRevoked',
        message:
          'Your account was accessed from another device. For financial security, simultaneous multi-device logins are restricted.',
      },
      403
    );
  }

  // Store user and payload on context
  c.set('user', user);
  c.set('tokenPayload', payload);
  c.set('sessionId', payload.sessionId);

  await next();
}

/**
 * Role-Based Access Control Gate
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user') as User | undefined;
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json(
        {
          success: false,
          error: 'Forbidden',
          message: `This action requires role [${allowedRoles.join(', ')}]. Your current role is [${user.role}].`,
        },
        403
      );
    }

    await next();
  };
}

/**
 * Farmer Subscription Gate:
 * Checks whether farmer is currently inside the 2-month (60 days) free trial or has paid KSH 20/mo
 */
export async function requireFarmerSubscription(c: Context<AppEnv>, next: Next) {
  const user = c.get('user') as User | undefined;
  if (!user || user.role !== 'farmer') {
    return next();
  }

  const isSubActive = authService.isSubscriptionActive(user.subscription);
  if (!isSubActive) {
    return c.json(
      {
        success: false,
        error: 'SubscriptionRequired',
        message:
          'Your free 2-month trial has ended. Please renew your farmer subscription (KES 20/month) to continue listing commodities.',
        subscription: user.subscription,
      },
      402
    );
  }

  await next();
}

/**
 * Agrovet License Verification Gate:
 * Agrovets require verified regulatory licensing before selling certified agricultural inputs
 */
export async function requireVerifiedAgrovet(c: Context<AppEnv>, next: Next) {
  const user = c.get('user') as User | undefined;
  if (!user || user.role !== 'agrovet') {
    return next();
  }

  const license = Array.from(dbManager.inMemory.agrovetLicenses.values()).find(
    (l) => l.agrovetUserId === user.id
  );

  if (!license || !license.isVerified) {
    return c.json(
      {
        success: false,
        error: 'LicensePendingVerification',
        message:
          'Your Agrovet premises and certification are currently pending administrative verification by Kenya Veterinary Board / KePHIS / Admin.',
        licenseStatus: license ? 'under_review' : 'not_submitted',
      },
      403
    );
  }

  await next();
}
