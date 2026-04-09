/**
 * auth.ts — Authentication routes
 *
 * POST /api/auth/login   — Authenticate with email + password, returns a Bearer token
 * POST /api/auth/register — Create a new account (first user becomes admin)
 *
 * These routes are NOT behind authMiddleware — they are public.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword, createToken } from '../middleware/auth';

const router = Router();

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const user = await prisma.appUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!user.active) {
    return res.status(403).json({ error: 'Account deactivated. Contact your administrator.' });
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = createToken(user.email);

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email?.trim() || !password || !name?.trim()) {
    return res.status(400).json({ error: 'email, password, and name are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.appUser.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // First user becomes admin, subsequent users are standard
  const userCount = await prisma.appUser.count();
  const role = userCount === 0 ? 'admin' : 'standard';

  const user = await prisma.appUser.create({
    data: {
      email: normalizedEmail,
      name: name.trim(),
      passwordHash: hashPassword(password),
      role,
      addedBy: 'self-registration',
    },
  });

  const token = createToken(user.email);

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

export default router;
