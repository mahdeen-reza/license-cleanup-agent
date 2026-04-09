/**
 * deltaComparison.ts
 *
 * Run-over-run comparison engine. Called as the final pipeline step after
 * results are saved to DB. Compares each user in the current run against
 * the most recent previous run for the same instance, tagging every result
 * with a delta category and storing summary counts on the AnalysisRun.
 *
 * Delta categories:
 *   newly_inactive        — was clean last run, now actionable
 *   persistently_inactive — actionable in both runs
 *   recovered             — was actionable last run, now clean
 *   reappeared            — was actioned (removed), now back
 *   net_new               — first appearance on this instance
 */

import { prisma } from '../lib/prisma';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeltaCategory =
  | 'newly_inactive'
  | 'persistently_inactive'
  | 'recovered'
  | 'reappeared'
  | 'net_new';

export interface DeltaSummary {
  isBaseline: boolean;
  previousRunId: string | null;
  previousRunDate: string | null;
  previousMode: string | null;
  daysSinceLastRun: number | null;
  modeMismatch: boolean;
  counts: {
    newlyInactive: number;
    persistentlyInactive: number;
    recovered: number;
    reappeared: number;
    netNew: number;
  };
}

// Classifications that represent an actionable / flagged state — anything
// other than Excluded (which means "never action")
const ACTIONABLE_CLASSIFICATIONS = new Set([
  'Direct Remove',
  'Notify First',
  'Ex-Employee',
  'GTM — Consult Required',
  'Cross-Instance Anomaly',
  'Prior Exception',
  'Human Review',
  'Unresolved',
]);

// ─── Main entry point ───────────────────────────────────────────────────────

export async function computeAndApplyDelta(
  currentRunId: string,
  instanceName: string,
  systemId: string,
  currentMode: string,
): Promise<DeltaSummary> {
  // 1. Find the most recent completed run for this instance (not this run)
  const previousRun = await prisma.analysisRun.findFirst({
    where: {
      instanceName,
      systemId,
      id: { not: currentRunId },
    },
    orderBy: { ranAt: 'desc' },
    select: {
      id: true,
      ranAt: true,
      mode: true,
    },
  });

  // No previous run → baseline
  if (!previousRun) {
    return {
      isBaseline: true,
      previousRunId: null,
      previousRunDate: null,
      previousMode: null,
      daysSinceLastRun: null,
      modeMismatch: false,
      counts: {
        newlyInactive: 0,
        persistentlyInactive: 0,
        recovered: 0,
        reappeared: 0,
        netNew: 0,
      },
    };
  }

  // 2. Set previousRunId on the current run
  await prisma.analysisRun.update({
    where: { id: currentRunId },
    data: { previousRunId: previousRun.id },
  });

  // 3. Load previous run results, build lookup by email
  const previousResults = await prisma.analysisResult.findMany({
    where: { runId: previousRun.id },
    select: {
      email: true,
      classification: true,
      actionStatus: true,
    },
  });

  const previousByEmail = new Map(
    previousResults.map((r) => [r.email.toLowerCase(), r]),
  );

  // 4. Load current run results
  const currentResults = await prisma.analysisResult.findMany({
    where: { runId: currentRunId },
    select: {
      id: true,
      email: true,
      classification: true,
    },
  });

  // 5. Compute delta category for each current result
  const counts = {
    newlyInactive: 0,
    persistentlyInactive: 0,
    recovered: 0,
    reappeared: 0,
    netNew: 0,
  };

  // Collect updates to batch via raw SQL for performance (large instances may have 1000+ users)
  const updates: { id: string; deltaCategory: DeltaCategory | null; previousClassification: string | null }[] = [];

  for (const current of currentResults) {
    const prev = previousByEmail.get(current.email.toLowerCase());

    if (!prev) {
      // Net new — first appearance
      updates.push({ id: current.id, deltaCategory: 'net_new', previousClassification: null });
      counts.netNew++;
    } else if (
      prev.actionStatus === 'actioned' &&
      ACTIONABLE_CLASSIFICATIONS.has(current.classification)
    ) {
      // Reappeared — was actioned (removed) in previous run, now back and actionable
      updates.push({ id: current.id, deltaCategory: 'reappeared', previousClassification: prev.classification });
      counts.reappeared++;
    } else if (
      ACTIONABLE_CLASSIFICATIONS.has(prev.classification) &&
      !ACTIONABLE_CLASSIFICATIONS.has(current.classification)
    ) {
      // Recovered — was actionable, now clean
      updates.push({ id: current.id, deltaCategory: 'recovered', previousClassification: prev.classification });
      counts.recovered++;
    } else if (
      ACTIONABLE_CLASSIFICATIONS.has(prev.classification) &&
      ACTIONABLE_CLASSIFICATIONS.has(current.classification)
    ) {
      // Persistently inactive — actionable in both runs
      updates.push({ id: current.id, deltaCategory: 'persistently_inactive', previousClassification: prev.classification });
      counts.persistentlyInactive++;
    } else if (
      !ACTIONABLE_CLASSIFICATIONS.has(prev.classification) &&
      ACTIONABLE_CLASSIFICATIONS.has(current.classification)
    ) {
      // Newly inactive — was clean, now actionable
      updates.push({ id: current.id, deltaCategory: 'newly_inactive', previousClassification: prev.classification });
      counts.newlyInactive++;
    } else {
      // No meaningful change — was fine before, still fine
      updates.push({ id: current.id, deltaCategory: null, previousClassification: prev.classification });
    }
  }

  // 6. Batch update results using a transaction of individual updates
  //    For large sets, we batch them in a single transaction to avoid N round trips
  await prisma.$transaction(
    updates
      .filter((u) => u.deltaCategory !== null || u.previousClassification !== null)
      .map((u) =>
        prisma.analysisResult.update({
          where: { id: u.id },
          data: {
            deltaCategory: u.deltaCategory,
            previousClassification: u.previousClassification,
          },
        }),
      ),
  );

  // 7. Update summary counts on the AnalysisRun
  const daysSinceLastRun = Math.round(
    (Date.now() - previousRun.ranAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  await prisma.analysisRun.update({
    where: { id: currentRunId },
    data: {
      newlyInactive: counts.newlyInactive,
      persistentlyInactive: counts.persistentlyInactive,
      recovered: counts.recovered,
      reappeared: counts.reappeared,
      netNew: counts.netNew,
    },
  });

  // 8. For reappeared users with active SporadicFlag, update lastReappearedAt
  const reappearedEmails = updates
    .filter((u) => u.deltaCategory === 'reappeared')
    .map((u) => {
      const result = currentResults.find((r) => r.id === u.id);
      return result?.email;
    })
    .filter((e): e is string => !!e);

  if (reappearedEmails.length > 0) {
    const now = new Date();

    // Update sporadic flags for reappeared users
    await prisma.sporadicFlag.updateMany({
      where: {
        userEmail: { in: reappearedEmails },
        instanceName,
        active: true,
      },
      data: { lastReappearedAt: now },
    });

    // 9. Write UserInstanceHistory events for reappeared users
    await prisma.userInstanceHistory.createMany({
      data: reappearedEmails.map((email) => ({
        userEmail: email,
        instanceName,
        eventType: 'reappeared',
        eventDate: now,
        runId: currentRunId,
        classification: currentResults.find(
          (r) => r.email.toLowerCase() === email.toLowerCase(),
        )?.classification ?? null,
        note: `Reappeared after being actioned in previous run (${previousRun.id})`,
      })),
    });
  }

  return {
    isBaseline: false,
    previousRunId: previousRun.id,
    previousRunDate: previousRun.ranAt.toISOString(),
    previousMode: previousRun.mode,
    daysSinceLastRun,
    modeMismatch: previousRun.mode !== currentMode,
    counts,
  };
}
