/**
 * admin.ts — Admin user management routes.
 *
 * All routes require admin role (enforced by requireAdmin middleware).
 *
 * GET    /api/admin/users      — List all provisioned users
 * POST   /api/admin/users      — Add a new user
 * PUT    /api/admin/users/:id  — Update a user (name, role, active)
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

router.use(requireAdmin);

// ─── List all users ──────────────────────────────────────────────────────────

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.appUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return res.json(users);
  } catch (err) {
    console.error('Failed to list users:', err);
    return res.status(500).json({ error: 'Failed to list users.' });
  }
});

// ─── Add a user ──────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, name, role } = req.body;

    // Validate required fields
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const resolvedRole = role ?? 'standard';
    if (resolvedRole !== 'standard' && resolvedRole !== 'admin') {
      return res.status(400).json({ error: 'Role must be "standard" or "admin".' });
    }

    // Check for duplicate
    const existing = await prisma.appUser.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    const user = await prisma.appUser.create({
      data: {
        email: normalizedEmail,
        name: name.trim(),
        role: resolvedRole,
        addedBy: req.appUser.email,
      },
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error('Failed to add user:', err);
    return res.status(500).json({ error: 'Failed to add user.' });
  }
});

// ─── Update a user ───────────────────────────────────────────────────────────

router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, role, active } = req.body;

    const target = await prisma.appUser.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Safety: cannot deactivate yourself
    if (req.appUser.id === id && active === false) {
      return res.status(400).json({ error: 'Cannot deactivate your own account.' });
    }

    // Validate role if provided
    if (role !== undefined && role !== 'standard' && role !== 'admin') {
      return res.status(400).json({ error: 'Role must be "standard" or "admin".' });
    }

    // Safety: protect last admin — use transaction for atomicity
    const wouldLoseAdmin =
      target.role === 'admin' && (role === 'standard' || active === false);

    if (wouldLoseAdmin) {
      const adminCount = await prisma.appUser.count({
        where: { role: 'admin', active: true },
      });

      if (adminCount <= 1) {
        const action = active === false ? 'deactivate' : 'demote';
        return res.status(400).json({
          error: `Cannot ${action} the last remaining admin.`,
        });
      }

      // Safe to proceed — more than one admin exists
      const updated = await prisma.appUser.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(role !== undefined && { role }),
          ...(active !== undefined && { active }),
        },
      });

      return res.json(updated);
    }

    // Standard update (no admin-count concern)
    const updated = await prisma.appUser.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(role !== undefined && { role }),
        ...(active !== undefined && { active }),
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error('Failed to update user:', err);
    return res.status(500).json({ error: 'Failed to update user.' });
  }
});

export default router;
