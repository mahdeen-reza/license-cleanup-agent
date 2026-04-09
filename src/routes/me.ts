/**
 * me.ts — GET /api/me
 *
 * Returns the current user's identity and role from the AppUser record
 * (set by authMiddleware).
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { id, email, name, role } = req.appUser;
  return res.json({ id, email, name, role });
});

export default router;
