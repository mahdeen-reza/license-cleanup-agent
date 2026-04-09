/**
 * sporadicFlags.ts
 *
 * POST   /api/sporadic-flags              — create/reactivate a flag
 * GET    /api/sporadic-flags/:instanceName — list active flags for an instance
 * PUT    /api/sporadic-flags/:id           — update note or deactivate
 */

import { Router, type Request, type Response } from 'express';
import {
  createSporadicFlag,
  listSporadicFlags,
  updateSporadicFlag,
  deactivateSporadicFlag,
} from '../core/sporadicFlagService';

const router = Router();

// ─── POST /api/sporadic-flags ───────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { systemId, instanceName, userEmail, userName, note } = req.body as {
    systemId?: string;
    instanceName?: string;
    userEmail?: string;
    userName?: string;
    note?: string;
  };

  if (!systemId || !instanceName || !userEmail || !userName || !note) {
    return res.status(400).json({
      error: 'systemId, instanceName, userEmail, userName, and note are all required.',
    });
  }

  const flag = await createSporadicFlag({
    systemId,
    instanceName,
    userEmail,
    userName,
    note,
    flaggedBy: req.userEmail,
  });

  return res.status(201).json(flag);
});

// ─── GET /api/sporadic-flags/:instanceName ──────────────────────────────────

router.get('/:instanceName', async (req: Request, res: Response) => {
  const { instanceName } = req.params;
  const flags = await listSporadicFlags(instanceName);
  return res.json(flags);
});

// ─── PUT /api/sporadic-flags/:id ────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note, active } = req.body as { note?: string; active?: boolean };

  if (active === false) {
    const flag = await deactivateSporadicFlag(id, req.userEmail);
    return res.json(flag);
  }

  if (note !== undefined) {
    const flag = await updateSporadicFlag(id, note, req.userEmail);
    return res.json(flag);
  }

  return res.status(400).json({ error: 'Provide note to update or active: false to deactivate.' });
});

export default router;
