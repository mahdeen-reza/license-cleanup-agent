import type { Request, Response, NextFunction } from 'express';

/**
 * Middleware that restricts access to admin users only.
 * Must be applied after authMiddleware (which sets req.appUser).
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.appUser.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  next();
}
