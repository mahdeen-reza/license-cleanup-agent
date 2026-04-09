/**
 * systems.ts
 *
 * GET /api/systems
 *   Returns all registered systems with their instance configs.
 *   Used by the frontend to populate the instance selector dropdown.
 *
 * GET /api/systems/:instanceName/exceptions
 *   Returns the prior exception register for a given instance (by instanceName).
 *   Keyed on instanceName because that's how the frontend knows which instance
 *   it is looking at — systemId is an internal UUID.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// ─── GET /api/systems ─────────────────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  const systems = await prisma.system.findMany({
    orderBy: { name: 'asc' },
    include: {
      instanceConfigs: {
        orderBy: { instanceName: 'asc' },
      },
      reasoningTable: true,
    },
  });

  return res.json(systems);
});

// ─── GET /api/systems/:instanceName/exceptions ────────────────────────────────

router.get('/:instanceName/exceptions', async (req: Request, res: Response) => {
  const { instanceName } = req.params;

  // PriorException rows are scoped by systemId. We resolve instanceName → system
  // via the InstanceConfig join so the client never needs to know internal UUIDs.
  const instanceConfig = await prisma.instanceConfig.findFirst({
    where: { instanceName },
    select: { systemId: true },
  });

  if (!instanceConfig) {
    return res.status(404).json({ error: `Instance "${instanceName}" not found.` });
  }

  const exceptions = await prisma.priorException.findMany({
    where: { systemId: instanceConfig.systemId },
    orderBy: { createdAt: 'asc' },
  });

  return res.json(exceptions);
});

export default router;
