/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import crypto from 'crypto';
import { dbManager } from '../db/mongo.ts';
import { authService } from '../services/auth.service.ts';
import { commsService } from '../services/communication.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import {
  registerSchema,
  loginSchema,
  setPayoutPasswordSchema,
  verifyPayoutPasswordSchema,
  provisionStaffSchema,
} from '../validators/schemas.ts';
import type { User } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';
import { requireRole } from '../middleware/auth.middleware.ts';

const authApp = new Hono<AppEnv>();

/**
 * Register new user: PUBLIC REGISTRATION ONLY PERMITS 'buyer', 'farmer', OR 'agrovet'
 * STRICT SECURITY: Admin and staff roles cannot be self-registered!
 */
authApp.post('/register', async (c) => {
  const body = await c.req.json();

  // Explicit hard defense: reject any attempt to self-assign admin or support_agent
  if (body?.role === 'admin' || body?.role === 'support_agent') {
    return c.json(
      {
        success: false,
        error: 'ForbiddenRole',
        message: 'Administrative roles cannot be created via public registration. Contact system security.',
      },
      403
    );
  }

  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const { email, phone, fullName, role, password, location, deviceFingerprint, deviceName } = parsed.data;
  const mem = dbManager.inMemory;

  // Check unique email and phone
  const existingUser = Array.from(mem.users.values()).find(
    (u) => u.email.toLowerCase() === email.toLowerCase() || u.phone === phone
  );

  if (existingUser) {
    return c.json({ success: false, error: 'User with this email or phone already exists.' }, 409);
  }

  const passwordHash = await authService.hash(password);
  const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();

  // Create initial user
  const newUser: User = {
    id: userId,
    email: email.toLowerCase(),
    phone,
    fullName,
    role,
    passwordHash,
    location,
    isPhoneVerified: true,
    isEmailVerified: true,
    subscription: role === 'farmer' ? authService.createFarmerSubscription() : undefined,
    deviceSessions: [],
    createdAt: now,
    updatedAt: now,
  };

  // Register device session
  const session = authService.registerDeviceSession(newUser, {
    fingerprint: deviceFingerprint,
    deviceName,
    ipAddress: c.req.header('x-forwarded-for') || '127.0.0.1',
    userAgent: c.req.header('user-agent'),
  });

  mem.users.set(newUser.id, newUser);

  // Generate tokens
  const tokenPayload = { userId: newUser.id, role: newUser.role, sessionId: session.sessionId, email: newUser.email };
  const accessToken = await authService.generateAccessToken(tokenPayload);
  const refreshToken = await authService.generateRefreshToken(tokenPayload);

  // Set secure HttpOnly cookies
  setCookie(c, 'access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 2 * 60 * 60, // 2 hours
    path: '/',
  });

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 365 * 24 * 60 * 60, // 1 year session as requested
    path: '/',
  });

  // Welcome message via ZeptoMail and WhatsApp
  await commsService.sendZeptoEmail({
    toEmail: newUser.email,
    toName: newUser.fullName,
    subject: 'Karibu FarmersWorld Kenya!',
    htmlBody: `<h2>Welcome to FarmersWorld!</h2><p>Your account as a <strong>${newUser.role}</strong> is ready. Your initial session is secured.</p>`,
  });

  return c.json(
    {
      success: true,
      message: 'Account registered successfully. Cookies set.',
      user: {
        id: newUser.id,
        email: newUser.email,
        phone: newUser.phone,
        fullName: newUser.fullName,
        role: newUser.role,
        location: newUser.location,
        subscription: newUser.subscription,
        hasPayoutPassword: !!newUser.payoutPasswordHash,
      },
    },
    201
  );
});

/**
 * Log in user
 */
authApp.post('/login', async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const { emailOrPhone, password, deviceFingerprint, deviceName } = parsed.data;
  const mem = dbManager.inMemory;

  const user = Array.from(mem.users.values()).find(
    (u) =>
      u.email.toLowerCase() === emailOrPhone.toLowerCase() ||
      u.phone === emailOrPhone ||
      u.phone === `+254${emailOrPhone.replace(/^0/, '')}`
  );

  if (!user) {
    return c.json({ success: false, error: 'Invalid credentials' }, 401);
  }

  const isPasswordValid = await authService.verify(password, user.passwordHash);
  if (!isPasswordValid) {
    return c.json({ success: false, error: 'Invalid credentials' }, 401);
  }

  // Register device session (enforces single active device policy)
  const session = authService.registerDeviceSession(user, {
    fingerprint: deviceFingerprint,
    deviceName,
    ipAddress: c.req.header('x-forwarded-for') || '127.0.0.1',
    userAgent: c.req.header('user-agent'),
  });

  // Generate tokens
  const tokenPayload = { userId: user.id, role: user.role, sessionId: session.sessionId, email: user.email };
  const accessToken = await authService.generateAccessToken(tokenPayload);
  const refreshToken = await authService.generateRefreshToken(tokenPayload);

  // Set secure HttpOnly cookies
  setCookie(c, 'access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 2 * 60 * 60,
    path: '/',
  });

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 365 * 24 * 60 * 60, // 1 year session
    path: '/',
  });

  return c.json({
    success: true,
    message: 'Login successful. Session secured via HttpOnly cookies.',
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      location: user.location,
      subscription: user.subscription,
      hasPayoutPassword: !!user.payoutPasswordHash,
    },
    activeSessionId: session.sessionId,
  });
});

/**
 * Log out
 */
authApp.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const sessionId = c.get('sessionId') as string;

  const session = user.deviceSessions.find((s) => s.sessionId === sessionId);
  if (session) {
    session.isRevoked = true;
  }
  user.activeSessionId = undefined;

  deleteCookie(c, 'access_token', { path: '/' });
  deleteCookie(c, 'refresh_token', { path: '/' });

  return c.json({ success: true, message: 'Logged out successfully' });
});

/**
 * Get current profile
 */
authApp.get('/me', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  return c.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      location: user.location,
      subscription: user.subscription,
      hasPayoutPassword: !!user.payoutPasswordHash,
      deviceSessionsCount: user.deviceSessions.length,
    },
  });
});

/**
 * List active & historical device sessions
 */
authApp.get('/sessions', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  return c.json({
    success: true,
    activeSessionId: user.activeSessionId,
    sessions: user.deviceSessions,
  });
});

/**
 * Revoke remote device session (e.g. if phone is lost)
 */
authApp.post('/sessions/revoke', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const { sessionId } = await c.req.json();

  const target = user.deviceSessions.find((s) => s.sessionId === sessionId);
  if (!target) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  target.isRevoked = true;
  if (user.activeSessionId === sessionId) {
    user.activeSessionId = undefined;
  }

  return c.json({ success: true, message: `Session ${sessionId} has been revoked successfully.` });
});

/**
 * Dual Password: Set or update payout password
 */
authApp.post('/payout-password/set', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = setPayoutPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const { accountPassword, payoutPassword } = parsed.data;

  // First verify account password
  const isAccountValid = await authService.verify(accountPassword, user.passwordHash);
  if (!isAccountValid) {
    return c.json({ success: false, error: 'Incorrect account password' }, 401);
  }

  // Hash secondary payout password
  user.payoutPasswordHash = await authService.hash(payoutPassword);
  user.updatedAt = new Date().toISOString();

  // Send security alert
  await commsService.sendZeptoEmail({
    toEmail: user.email,
    toName: user.fullName,
    subject: 'Security Alert: Payout Password Configured',
    htmlBody: `<p>A secondary payout password was just configured on your FarmersWorld account for withdrawal authorization.</p>`,
  });

  return c.json({
    success: true,
    message: 'Payout password set successfully. This will be required for all financial disbursements and transfers.',
  });
});

/**
 * Dual Password: Verify payout password
 */
authApp.post('/payout-password/verify', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = verifyPayoutPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  if (!user.payoutPasswordHash) {
    return c.json(
      {
        success: false,
        error: 'PayoutPasswordNotConfigured',
        message: 'Please set up a payout password first under /api/auth/payout-password/set before withdrawing funds.',
      },
      400
    );
  }

  const isValid = await authService.verify(parsed.data.payoutPassword, user.payoutPasswordHash);
  if (!isValid) {
    return c.json({ success: false, error: 'Invalid payout password' }, 401);
  }

  return c.json({ success: true, message: 'Payout password verified successfully' });
});

/**
 * ADMIN ONLY: Provision Internal Staff or Compliance Agent
 * Administrative accounts can NEVER be created by open public registration.
 */
authApp.post('/admin/provision-staff', authMiddleware, requireRole('admin'), async (c) => {
  const currentAdmin = c.get('user') as User;
  const body = await c.req.json();
  const parsed = provisionStaffSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const { email, phone, fullName, role, temporaryPassword, location } = parsed.data;
  const mem = dbManager.inMemory;

  const existing = Array.from(mem.users.values()).find(
    (u) => u.email.toLowerCase() === email.toLowerCase() || u.phone === phone
  );
  if (existing) {
    return c.json({ success: false, error: 'Staff user with this email or phone already exists.' }, 409);
  }

  const passwordHash = await authService.hash(temporaryPassword);
  const payoutPasswordHash = await authService.hash('0000');
  const userId = `usr_${role}_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  const newStaff: User = {
    id: userId,
    email: email.toLowerCase(),
    phone,
    fullName,
    role,
    passwordHash,
    payoutPasswordHash,
    location: location || currentAdmin.location,
    isPhoneVerified: true,
    isEmailVerified: true,
    deviceSessions: [],
    createdAt: now,
    updatedAt: now,
  };

  mem.users.set(newStaff.id, newStaff);

  return c.json(
    {
      success: true,
      message: `Staff account (${role}) provisioned successfully by Admin #${currentAdmin.id}.`,
      staff: {
        id: newStaff.id,
        email: newStaff.email,
        phone: newStaff.phone,
        fullName: newStaff.fullName,
        role: newStaff.role,
      },
    },
    201
  );
});

export default authApp;
