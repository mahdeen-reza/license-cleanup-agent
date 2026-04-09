/**
 * userHistory.ts
 *
 * GET /api/user-history/:email/:instanceName
 *   Returns the complete per-user timeline for a specific instance.
 */

import { Router, type Request, type Response } from 'express';
import { getUserHistory } from '../core/userHistoryService';

const router = Router();

router.get('/:email/:instanceName', async (req: Request, res: Response) => {
  const { email, instanceName } = req.params;

  if (!email?.trim()) {
    return res.status(400).json({ error: 'email is required.' });
  }
  if (!instanceName?.trim()) {
    return res.status(400).json({ error: 'instanceName is required.' });
  }

  const history = await getUserHistory(email.trim(), instanceName.trim());
  return res.json(history);
});

export default router;
