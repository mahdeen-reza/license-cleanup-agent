/**
 * actionTracker.ts
 *
 * Processes analyst actioning decisions — marks analysis results as
 * "actioned" or "deferred", writes audit events to UserInstanceHistory,
 * and updates SporadicFlag removal counts for actioned sporadic users.
 */

import { prisma } from '../lib/prisma';

export interface ActionItem {
  resultId: string;
  status: 'actioned' | 'deferred';
  note?: string;
}

export interface ActionResponse {
  actionedCount: number;
  deferredCount: number;
  actionedEmails: string[];
}

export async function processActions(
  runId: string,
  actions: ActionItem[],
  actorEmail: string,
): Promise<ActionResponse> {
  // Load the run to get instanceName for history events
  const run = await prisma.analysisRun.findUniqueOrThrow({
    where: { id: runId },
    select: { instanceName: true },
  });

  // Load all targeted results in one query
  const resultIds = actions.map((a) => a.resultId);
  const results = await prisma.analysisResult.findMany({
    where: { id: { in: resultIds }, runId },
    select: { id: true, email: true, classification: true, actionStatus: true },
  });

  const resultMap = new Map(results.map((r) => [r.id, r]));

  // Validate every resultId belongs to this run
  for (const action of actions) {
    if (!resultMap.has(action.resultId)) {
      throw new Error(`Result ${action.resultId} not found in run ${runId}`);
    }
  }

  // Separate actions into pending-only (skip already processed)
  const toProcess: Array<ActionItem & { email: string; classification: string }> = [];
  for (const action of actions) {
    const result = resultMap.get(action.resultId)!;
    if (result.actionStatus !== 'pending') {
      console.warn(
        `Skipping result ${action.resultId} — already ${result.actionStatus}`,
      );
      continue;
    }
    toProcess.push({ ...action, email: result.email, classification: result.classification });
  }

  const now = new Date();

  // Load active sporadic flags for actioned users on this instance
  const actionedEmails = toProcess
    .filter((a) => a.status === 'actioned')
    .map((a) => a.email);

  const sporadicFlags =
    actionedEmails.length > 0
      ? await prisma.sporadicFlag.findMany({
          where: {
            userEmail: { in: actionedEmails },
            instanceName: run.instanceName,
            active: true,
          },
        })
      : [];

  const sporadicByEmail = new Map(sporadicFlags.map((f) => [f.userEmail, f]));

  // Execute everything in a transaction
  await prisma.$transaction(async (tx) => {
    // Update each result's action status
    for (const action of toProcess) {
      await tx.analysisResult.update({
        where: { id: action.resultId },
        data: {
          actionStatus: action.status,
          actionedAt: action.status === 'actioned' ? now : null,
          actionedBy: actorEmail,
          actionNote: action.note ?? null,
        },
      });
    }

    // Write UserInstanceHistory events
    await tx.userInstanceHistory.createMany({
      data: toProcess.map((action) => ({
        userEmail: action.email,
        instanceName: run.instanceName,
        eventType: action.status, // "actioned" or "deferred"
        eventDate: now,
        runId,
        classification: action.classification,
        note: action.note ?? null,
        actorEmail,
      })),
    });

    // Increment removalCount on sporadic flags for actioned users
    for (const email of actionedEmails) {
      const flag = sporadicByEmail.get(email);
      if (flag) {
        await tx.sporadicFlag.update({
          where: { id: flag.id },
          data: {
            removalCount: { increment: 1 },
            lastRemovedAt: now,
          },
        });
      }
    }
  });

  const sortedEmails = actionedEmails.slice().sort();

  return {
    actionedCount: toProcess.filter((a) => a.status === 'actioned').length,
    deferredCount: toProcess.filter((a) => a.status === 'deferred').length,
    actionedEmails: sortedEmails,
  };
}
