import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

/**
 * Shape attached to req.appUser after successful authorization.
 */
export interface AppUserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
}

/**
 * Extends Express Request with both the legacy `userEmail` string
 * (used by all existing routes) and the new `appUser` record.
 */
declare global {
  namespace Express {
    interface Request {
      userEmail: string;
      appUser: AppUserRecord;
    }
  }
}

// ─── Password hashing ────────────────────────────────────────────────────────

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

/** Hash a plaintext password using scrypt with a random salt */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

/** Verify a plaintext password against a stored hash */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

// ─── Token signing ───────────────────────────────────────────────────────────

const TOKEN_SECRET = process.env.TOKEN_SECRET ?? 'dev-secret-change-in-production';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Create a signed token encoding the user's email and expiry */
export function createToken(email: string): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ email, exp: expiry })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/** Verify and decode a token — returns the email or null if invalid/expired */
export function verifyToken(token: string): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payload)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email?: string;
      exp?: number;
    };
    if (!decoded.email || !decoded.exp) return null;
    if (Date.now() > decoded.exp) return null;
    return decoded.email;
  } catch {
    return null;
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

/**
 * Identity + authorization middleware.
 *
 * 1. Resolves the user's email from a Bearer token (production)
 *    or DEV_USER_EMAIL (local dev).
 * 2. Looks up the email in the AppUser table.
 *    - Not found / inactive -> 403.
 *    - Found and active -> attaches `req.appUser` and `req.userEmail`.
 *
 * In local dev (NODE_ENV !== 'production'), a missing AppUser is auto-created
 * as admin so development works without manual seeding.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const devEmail = process.env.DEV_USER_EMAIL ?? 'dev@company.com';
  let email: string | null = null;

  // Try Bearer token first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    email = verifyToken(token);
    if (!email) {
      res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
      return;
    }
  }

  // Fall back to dev email in non-production
  if (!email) {
    if (process.env.NODE_ENV === 'production') {
      res.status(401).json({ error: 'Authentication required. Send a Bearer token in the Authorization header.' });
      return;
    }
    email = devEmail;
  }

  email = email.toLowerCase();

  try {
    let appUser = await prisma.appUser.findUnique({ where: { email } });

    // Auto-provision dev user in non-production environments
    if (!appUser && process.env.NODE_ENV !== 'production') {
      appUser = await prisma.appUser.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: email.split('@')[0],
          role: 'admin',
          addedBy: 'dev-auto',
        },
      });
    }

    if (!appUser) {
      res.status(403).json({
        error: 'Access denied. You are not provisioned for this application. Contact your administrator.',
      });
      return;
    }

    if (!appUser.active) {
      res.status(403).json({
        error: 'Access denied. Your account has been deactivated. Contact your administrator.',
      });
      return;
    }

    req.appUser = {
      id: appUser.id,
      email: appUser.email,
      name: appUser.name,
      role: appUser.role,
      active: appUser.active,
    };
    req.userEmail = appUser.email;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authorization.' });
  }
}
