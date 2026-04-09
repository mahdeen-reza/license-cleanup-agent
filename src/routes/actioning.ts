/**
 * actioning.ts
 *
 * POST /api/analysis/:runId/action
 *   Accepts analyst actioning decisions and updates DB atomically.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { processActions, type ActionItem } from '../core/actionTracker';

const router = Router();

router.post('/:runId/action', async (req: Request, res: Response) => {
  const { runId } = req.params;

  // Validate run exists
  const run = await prisma.analysisRun.findUnique({
    where: { id: runId },
    select: { id: true, systemId: true },
  });

  if (!run) {
    return res.status(404).json({ error: `Run ${runId} not found.` });
  }

  // Validate request body
  const { actions } = req.body as { actions?: ActionItem[] };

  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'actions array is required and must not be empty.' });
  }

  // Validate each action item
  for (const action of actions) {
    if (!action.resultId || !['actioned', 'deferred'].includes(action.status)) {
      return res.status(400).json({
        error: 'Each action must have a resultId and status ("actioned" or "deferred").',
      });
    }
  }

  try {
    const result = await processActions(runId, actions, req.userEmail);

    return res.json({
      success: true,
      actionedCount: result.actionedCount,
      deferredCount: result.deferredCount,
      actionedEmails: result.actionedEmails,
      emailListText: result.actionedEmails.join('\n'),
    });
  } catch (err) {
    console.error('Action processing failed:', err);
    const message = err instanceof Error ? err.message : '';
    if (message.includes('not found in run')) {
      return res.status(400).json({ error: 'One or more result IDs are invalid for this run.' });
    }
    return res.status(500).json({ error: 'Failed to process actions.' });
  }
});

export default router;
