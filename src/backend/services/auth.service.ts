/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import bcrypt from 'bcryptjs';
import * as jose from 'jose';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import type { User, UserRole, DeviceSession, GeoLocation } from '../types/index.ts';

const JWT_SECRET_STRING = process.env.JWT_SECRET || 'farmersworld-super-secret-jwt-key-2026-kenya';
const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET_STRING);

export interface TokenPayload {
  userId: string;
  role: UserRole;
  sessionId: string;
  email: string;
}

export class AuthService {
  /**
   * Hashes passwords using bcryptjs with high salt rounds
   */
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * Verifies passwords using bcryptjs
   */
  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates short-lived Access Token (2 hours)
   */
  async generateAccessToken(payload: TokenPayload): Promise<string> {
    return new jose.SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(JWT_SECRET_BYTES);
  }

  /**
   * Generates 1-year Refresh Token for financial sessions
   */
  async generateRefreshToken(payload: TokenPayload): Promise<string> {
    return new jose.SignJWT({ ...payload, isRefresh: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('365d') // 1 year session as requested
      .sign(JWT_SECRET_BYTES);
  }

  /**
   * Verifies JWT token
   */
  async verifyToken(token: string): Promise<TokenPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(token, JWT_SECRET_BYTES);
      return payload as unknown as TokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Single-Device Enforcement & Device Session Management:
   * Financial institutions restrict concurrent unknown logins.
   * If user logs in from a new device, previous session is flagged/revoked
   * or requires remote logout.
   */
  registerDeviceSession(
    user: User,
    deviceInfo: { fingerprint: string; deviceName?: string; ipAddress?: string; userAgent?: string }
  ): DeviceSession {
    const sessionId = `sess_${crypto.randomBytes(12).toString('hex')}`;
    const now = new Date().toISOString();

    // Check if device fingerprint matches existing active session
    const existingSession = user.deviceSessions.find(
      (s) => s.deviceFingerprint === deviceInfo.fingerprint && !s.isRevoked
    );

    if (existingSession) {
      existingSession.lastActive = now;
      user.activeSessionId = existingSession.sessionId;
      return existingSession;
    }

    // New device login: Revoke previous device session for strict single-device financial protection
    for (const sess of user.deviceSessions) {
      sess.isRevoked = true;
    }

    const newSession: DeviceSession = {
      sessionId,
      deviceFingerprint: deviceInfo.fingerprint,
      deviceName: deviceInfo.deviceName || 'Personal Mobile / Web',
      ipAddress: deviceInfo.ipAddress,
      userAgent: deviceInfo.userAgent,
      lastActive: now,
      createdAt: now,
      isRevoked: false,
    };

    user.deviceSessions.push(newSession);
    user.activeSessionId = sessionId;
    user.updatedAt = now;

    return newSession;
  }

  /**
   * Initializes 2-month (60 days) free trial subscription for farmers
   */
  createFarmerSubscription(): User['subscription'] {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days (2 months) free
    return {
      status: 'trial',
      trialStartDate: now.toISOString(),
      trialEndDate: trialEnd.toISOString(),
      monthlyFee: 20, // KSH 20 / month
      autoRenew: true,
      paymentMethod: 'paystack',
    };
  }

  /**
   * Checks subscription status for farmers
   */
  isSubscriptionActive(sub?: User['subscription']): boolean {
    if (!sub) return false;
    const now = Date.now();
    if (sub.status === 'trial') {
      return new Date(sub.trialEndDate).getTime() > now;
    }
    if (sub.status === 'active') {
      return !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() > now;
    }
    return false;
  }
}

export const authService = new AuthService();
