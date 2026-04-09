/**
 * analysis.ts
 *
 * POST /api/analysis/run
 *   Accepts multipart form upload of two CSV files plus run config.
 *   Runs the full pipeline and returns structured 7-tab output.
 *
 * GET /api/analysis/history
 *   Returns past analysis runs for the current user, most recent first.
 */

import { Router, type Request, type Response } from 'express';
import type { Multer } from 'multer';
import { prisma } from '../lib/prisma';
import { enrichUsers } from '../core/hrEnricher';
import { classifyAll } from '../core/classifier';
import { runReasoningEngine } from '../intelligence/reasoningEngine';
import type {
  SfInstance,
  CleanupMode,
  PriorExceptionRecord,
  Classification,
} from '../core/classifier';
import type { ReasoningResult, RunConfig, InstanceConfig } from '../intelligence/reasoningEngine';
import type { EnrichedUser } from '../core/hrEnricher';
import { getSporadicFlagsBatch } from '../core/sporadicFlagService';
import { computeAndApplyDelta } from '../core/deltaComparison';
import type { DeltaSummary } from '../core/deltaComparison';

const router = Router();

// ─── Multer instance (injected by server.ts) ──────────────────────────────────
// We export a factory so server.ts can pass in its configured multer instance,
// keeping upload config (memory storage, file limits) in one place.

export function createAnalysisRouter(upload: Multer) {
  // ─── POST /api/analysis/run ─────────────────────────────────────────────────

  router.post(
    '/run',
    upload.fields([
      { name: 'usageFile', maxCount: 1 },
      { name: 'hrFile', maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
     try {
      // ── 1. Validate inputs ────────────────────────────────────────────────
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const usageFile = files?.['usageFile']?.[0];
      const hrFile = files?.['hrFile']?.[0];

      if (!usageFile || !hrFile) {
        return res.status(400).json({ error: 'Both usageFile and hrFile are required.' });
      }

      const { instance, cleanupType, mode, licensesNeeded } = req.body as {
        instance?: string;
        cleanupType?: string;
        mode?: string;
        licensesNeeded?: string;
      };

      const VALID_INSTANCES: SfInstance[] = [
        'Instance A', 'Instance B', 'Instance C', 'Instance D', 'Instance E',
      ];
      const VALID_MODES: CleanupMode[] = ['standard', 'urgent', 'critical'];
      const VALID_TYPES = ['routine', 'on_demand'];

      if (!instance || !VALID_INSTANCES.includes(instance as SfInstance)) {
        return res.status(400).json({ error: `instance must be one of: ${VALID_INSTANCES.join(', ')}` });
      }
      if (!mode || !VALID_MODES.includes(mode as CleanupMode)) {
        return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(', ')}` });
      }
      if (!cleanupType || !VALID_TYPES.includes(cleanupType)) {
        return res.status(400).json({ error: `cleanupType must be one of: ${VALID_TYPES.join(', ')}` });
      }
      if (cleanupType === 'on_demand' && !licensesNeeded) {
        return res.status(400).json({ error: 'licensesNeeded is required for on_demand runs.' });
      }

      const sfInstance = instance as SfInstance;
      const sfMode = mode as CleanupMode;
      const sfCleanupType = cleanupType as 'routine' | 'on_demand';
      const licensesNeededNum = licensesNeeded ? parseInt(licensesNeeded, 10) : undefined;

      // ── 2. Resolve system + instance config from DB ──────────────────────
      const dbInstanceConfig = await prisma.instanceConfig.findFirst({
        where: { instanceName: sfInstance },
        include: { system: true },
      });

      if (!dbInstanceConfig) {
        return res.status(404).json({ error: `Instance "${sfInstance}" is not configured in the database. Run seeding first.` });
      }

      const instanceConfig: InstanceConfig = {
        instanceName: dbInstanceConfig.instanceName,
        defaultScope: dbInstanceConfig.defaultScope,
        thresholds: dbInstanceConfig.thresholds as { standardDays: number; urgentDays: number },
        productAlignment: dbInstanceConfig.productAlignment as { matchingProducts: string[] } | null,
        gtmHandling: dbInstanceConfig.gtmHandling,
      };

      // ── 3. Load prior exceptions for this system ─────────────────────────
      const dbExceptions = await prisma.priorException.findMany({
        where: { systemId: dbInstanceConfig.systemId },
      });

      const priorExceptions: PriorExceptionRecord[] = dbExceptions.map((e) => ({
        userEmail: e.userEmail,
        userName: e.userName,
        justification: e.justification,
        action: e.action as 'keep_flag' | 'remove_with_confirmation',
      }));

      // ── 4. Parse CSVs + enrich users ─────────────────────────────────────
      const { enrichedUsers, tier3MatchCount } = enrichUsers(
        usageFile.buffer,
        hrFile.buffer,
      );

      // ── 5. Deterministic pre-classification ──────────────────────────────
      const preClassifications = classifyAll(
        enrichedUsers,
        { instance: sfInstance, mode: sfMode },
        priorExceptions,
      );

      // ── 6. Check sporadic flag register ──────────────────────────────────
      const allEmails = enrichedUsers.map((u) => u.email);
      const sporadicFlags = await getSporadicFlagsBatch(allEmails, sfInstance);

      for (const user of enrichedUsers) {
        const flag = sporadicFlags.get(user.email);
        if (flag) {
          user.sporadicFlag = {
            active: true,
            note: flag.note,
            removalCount: flag.removalCount,
            lastRemovedAt: flag.lastRemovedAt,
            lastReappearedAt: flag.lastReappearedAt,
            flaggedBy: flag.flaggedBy,
            flaggedAt: flag.flaggedAt,
          };
        }
      }

      // ── 7. AI reasoning pass ──────────────────────────────────────────────
      const runConfig: RunConfig = {
        instance: sfInstance,
        mode: sfMode,
        cleanupType: sfCleanupType,
        licensesNeeded: licensesNeededNum,
      };

      const reasoningResults = await runReasoningEngine(
        preClassifications,
        runConfig,
        instanceConfig,
        priorExceptions,
      );

      // ── 7. Merge pre-classification context with AI results ────────────
      // Build a map from email → enriched user for merging
      const userByEmail = new Map<string, EnrichedUser>(
        enrichedUsers.map((u) => [u.email.toLowerCase(), u]),
      );

      // ── 8. Tally counts ───────────────────────────────────────────────────
      const counts = {
        directRemove: 0,
        notifyFirst: 0,
        exEmployees: 0,
        gtmFlagged: 0,
        priorException: 0,
        humanReview: 0,
        excluded: 0,
      };

      for (const r of reasoningResults) {
        switch (r.classification) {
          case 'Direct Remove':       counts.directRemove++; break;
          case 'Notify First':        counts.notifyFirst++; break;
          case 'Ex-Employee':         counts.exEmployees++; break;
          case 'GTM — Consult Required':
          case 'Cross-Instance Anomaly': counts.gtmFlagged++; break;
          case 'Prior Exception':     counts.priorException++; break;
          case 'Human Review':
          case 'Unresolved':          counts.humanReview++; break;
          case 'Excluded':            counts.excluded++; break;
        }
      }

      // ── 9. Save run + results to DB ───────────────────────────────────────
      const run = await prisma.analysisRun.create({
        data: {
          systemId: dbInstanceConfig.systemId,
          instanceName: sfInstance,
          cleanupType: sfCleanupType,
          mode: sfMode,
          licensesNeeded: licensesNeededNum ?? null,
          ranByEmail: req.userEmail,
          totalUsers: enrichedUsers.length,
          ...counts,
          results: {
            create: reasoningResults.map((r) => {
              const u = userByEmail.get(r.email.toLowerCase());
              const pc = preClassifications.find(
                (p) => p.user.email.toLowerCase() === r.email.toLowerCase(),
              );
              return {
                email: r.email,
                fullName: u?.fullName ?? '',
                department: u?.department ?? '',
                division: u?.division ?? '',
                businessTitle: u?.businessTitle ?? '',
                region: u?.region ?? '',
                product: u?.product ?? '',
                managerEmail: u?.managerEmail ?? '',
                onLeave: u?.onLeave ?? '',
                workerType: u?.workerType ?? '',
                acquisitionCompany: u?.acquisitionCompany ?? null,
                sfCreatedDate: u?.sfCreatedDate ?? '',
                lastActivityDate: u?.lastActivityDate ?? null,
                monthlyActivity: u?.monthlyActivity ?? null,
                sfLastActivityDate: u?.sfLastActivityDate ?? null,
                sfDaysActive: u?.sfDaysActive ?? null,
                platformLastDate: u?.platformLastDate ?? null,
                platformDaysActive: u?.platformDaysActive ?? null,
                permissionSets: u?.permissionSets ?? null,
                profile: u?.profile ?? null,
                classification: r.classification,
                confidenceLevel: r.confidenceLevel,
                matchTier: u?.normalization.matchTier ?? 0,
                reasoning: r.reasoning,
              };
            }),
          },
        },
        include: { results: true },
      });

      // ── 10. Delta comparison ─────────────────────────────────────────────
      const deltaSummary = await computeAndApplyDelta(
        run.id,
        sfInstance,
        dbInstanceConfig.systemId,
        sfMode,
      );

      // Reload results with delta fields populated
      const updatedResults = await prisma.analysisResult.findMany({
        where: { runId: run.id },
      });

      // ── 11. Write UserInstanceHistory events for all classified users ─────
      const now = new Date();
      await prisma.userInstanceHistory.createMany({
        data: updatedResults.map((r) => ({
          userEmail: r.email,
          instanceName: sfInstance,
          eventType: 'analysis_run' as const,
          eventDate: now,
          runId: run.id,
          classification: r.classification,
          note: `Classified as ${r.classification} (${r.confidenceLevel} confidence) in ${sfMode} mode ${sfCleanupType} run`,
        })),
      });

      // ── 12. Build structured 7-tab response ───────────────────────────────
      const tabs = groupByTab(updatedResults as AnalysisResultRow[], tier3MatchCount, sfInstance, sfMode, req.userEmail);

      // Build sporadic flag lookup for the response (email → flag data)
      const sporadicFlagMap: Record<string, { note: string; removalCount: number; lastRemovedAt: string | null; lastReappearedAt: string | null; flaggedBy: string; flaggedAt: string }> = {};
      for (const [email, flag] of sporadicFlags) {
        sporadicFlagMap[email] = {
          note: flag.note,
          removalCount: flag.removalCount,
          lastRemovedAt: flag.lastRemovedAt,
          lastReappearedAt: flag.lastReappearedAt,
          flaggedBy: flag.flaggedBy,
          flaggedAt: flag.flaggedAt,
        };
      }

      return res.status(201).json({
        runId: run.id,
        summary: {
          systemName: dbInstanceConfig.system.name,
          instance: sfInstance,
          mode: sfMode,
          cleanupType: sfCleanupType,
          ranByEmail: req.userEmail,
          ranAt: run.ranAt,
          totalUsers: run.totalUsers,
          counts,
          tier3MatchCount,
          warnings: tier3MatchCount > 0
            ? [`${tier3MatchCount} user(s) matched by name only — verify recommended.`]
            : [],
        },
        tabs,
        sporadicFlags: sporadicFlagMap,
        deltaSummary,
      });
     } catch (err) {
      console.error('Analysis pipeline error:', err);
      return res.status(500).json({ error: 'Analysis failed. Check server logs for details.' });
     }
    },
  );

  // ─── GET /api/analysis/:runId/delta ─────────────────────────────────────────

  router.get('/:runId/delta', async (req: Request, res: Response) => {
    const { runId } = req.params;

    const run = await prisma.analysisRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        mode: true,
        ranAt: true,
        previousRunId: true,
        newlyInactive: true,
        persistentlyInactive: true,
        recovered: true,
        reappeared: true,
        netNew: true,
        previousRun: {
          select: {
            id: true,
            ranAt: true,
            mode: true,
          },
        },
      },
    });

    if (!run) {
      return res.status(404).json({ error: `Run ${runId} not found.` });
    }

    if (!run.previousRunId || !run.previousRun) {
      return res.json({
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
      });
    }

    const daysSinceLastRun = Math.round(
      (run.ranAt.getTime() - run.previousRun.ranAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    return res.json({
      isBaseline: false,
      previousRunId: run.previousRunId,
      previousRunDate: run.previousRun.ranAt.toISOString(),
      previousMode: run.previousRun.mode,
      daysSinceLastRun,
      modeMismatch: run.previousRun.mode !== run.mode,
      counts: {
        newlyInactive: run.newlyInactive,
        persistentlyInactive: run.persistentlyInactive,
        recovered: run.recovered,
        reappeared: run.reappeared,
        netNew: run.netNew,
      },
    });
  });

  // ─── GET /api/analysis/history ──────────────────────────────────────────────
  // MUST be registered before /:runId to avoid "history" matching as a runId.

  router.get('/history', async (req: Request, res: Response) => {
    const runs = await prisma.analysisRun.findMany({
      where: { ranByEmail: req.userEmail },
      orderBy: { ranAt: 'desc' },
      select: {
        id: true,
        instanceName: true,
        cleanupType: true,
        mode: true,
        licensesNeeded: true,
        ranByEmail: true,
        ranAt: true,
        totalUsers: true,
        system: { select: { name: true } },
        results: {
          where: { actionStatus: 'actioned' },
          select: { id: true },
        },
      },
    });

    return res.json(
      runs.map((run) => ({
        id: run.id,
        systemName: run.system.name,
        instanceName: run.instanceName,
        cleanupType: run.cleanupType,
        mode: run.mode,
        licensesNeeded: run.licensesNeeded,
        ranByEmail: run.ranByEmail,
        ranAt: run.ranAt,
        totalUsers: run.totalUsers,
        actionedUsers: run.results.length,
      })),
    );
  });

  // ─── GET /api/analysis/:runId ────────────────────────────────────────────────
  // Load full details of a past run (same shape as POST /run response).

  router.get('/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;

    const run = await prisma.analysisRun.findUnique({
      where: { id: runId },
      include: { results: true, system: { select: { name: true } } },
    });

    if (!run) {
      return res.status(404).json({ error: `Run ${runId} not found.` });
    }

    // Counts
    const counts = {
      directRemove: run.directRemove,
      notifyFirst: run.notifyFirst,
      exEmployees: run.exEmployees,
      gtmFlagged: run.gtmFlagged,
      priorException: run.priorException,
      humanReview: run.humanReview,
      excluded: run.excluded,
    };

    // Tier 3 count from stored results
    const tier3MatchCount = run.results.filter((r) => r.matchTier === 3).length;

    // Group into tabs
    const tabs = groupByTab(
      run.results as unknown as AnalysisResultRow[],
      tier3MatchCount,
      run.instanceName,
      run.mode,
      run.ranByEmail,
    );

    // Load sporadic flags for all users in this run
    const allEmails = run.results.map((r) => r.email);
    const sporadicFlags = await getSporadicFlagsBatch(allEmails, run.instanceName);
    const sporadicFlagMap: Record<string, { note: string; removalCount: number; lastRemovedAt: string | null; lastReappearedAt: string | null; flaggedBy: string; flaggedAt: string }> = {};
    for (const [email, flag] of sporadicFlags) {
      sporadicFlagMap[email] = {
        note: flag.note,
        removalCount: flag.removalCount,
        lastRemovedAt: flag.lastRemovedAt,
        lastReappearedAt: flag.lastReappearedAt,
        flaggedBy: flag.flaggedBy,
        flaggedAt: flag.flaggedAt,
      };
    }

    // Load delta summary
    let deltaSummary: DeltaSummary | undefined;
    if (run.previousRunId) {
      const previousRun = await prisma.analysisRun.findUnique({
        where: { id: run.previousRunId },
        select: { id: true, ranAt: true, mode: true },
      });
      if (previousRun) {
        const daysSinceLastRun = Math.round(
          (run.ranAt.getTime() - previousRun.ranAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        deltaSummary = {
          isBaseline: false,
          previousRunId: run.previousRunId,
          previousRunDate: previousRun.ranAt.toISOString(),
          previousMode: previousRun.mode,
          daysSinceLastRun,
          modeMismatch: previousRun.mode !== run.mode,
          counts: {
            newlyInactive: run.newlyInactive,
            persistentlyInactive: run.persistentlyInactive,
            recovered: run.recovered,
            reappeared: run.reappeared,
            netNew: run.netNew,
          },
        };
      }
    }

    return res.json({
      runId: run.id,
      summary: {
        systemName: run.system.name,
        instance: run.instanceName,
        mode: run.mode,
        cleanupType: run.cleanupType,
        ranByEmail: run.ranByEmail,
        ranAt: run.ranAt,
        totalUsers: run.totalUsers,
        counts,
        tier3MatchCount,
        warnings: tier3MatchCount > 0
          ? [`${tier3MatchCount} user(s) matched by name only — verify recommended.`]
          : [],
      },
      tabs,
      sporadicFlags: sporadicFlagMap,
      deltaSummary: deltaSummary ?? { isBaseline: true, previousRunId: null, previousRunDate: null, previousMode: null, daysSinceLastRun: null, modeMismatch: false, counts: { newlyInactive: 0, persistentlyInactive: 0, recovered: 0, reappeared: 0, netNew: 0 } },
    });
  });

  return router;
}

// ─── Tab grouping helper ──────────────────────────────────────────────────────

interface AnalysisResultRow {
  id: string;
  email: string;
  fullName: string;
  department: string;
  division: string;
  businessTitle: string;
  region: string;
  product: string;
  managerEmail: string;
  onLeave: string;
  workerType: string;
  acquisitionCompany: string | null;
  sfCreatedDate: string;
  lastActivityDate: string | null;
  monthlyActivity: number | null;
  sfLastActivityDate: string | null;
  sfDaysActive: number | null;
  platformLastDate: string | null;
  platformDaysActive: number | null;
  permissionSets: string | null;
  profile: string | null;
  classification: string;
  confidenceLevel: string;
  matchTier: number;
  reasoning: string;
  actionStatus: string;
  deltaCategory: string | null;
  previousClassification: string | null;
}

const TAB_CLASSIFICATIONS: Record<string, Classification[]> = {
  directRemove:   ['Direct Remove'],
  notifyFirst:    ['Notify First'],
  exEmployee:     ['Ex-Employee'],
  gtmFlagged:     ['GTM — Consult Required', 'Cross-Instance Anomaly'],
  priorException: ['Prior Exception'],
  humanReview:    ['Human Review', 'Unresolved'],
  excluded:       ['Excluded'],
};

function groupByTab(
  results: AnalysisResultRow[],
  tier3MatchCount: number,
  instance: string,
  mode: string,
  analystEmail: string,
) {
  const tabs: Record<string, AnalysisResultRow[]> = {
    directRemove: [],
    notifyFirst: [],
    exEmployee: [],
    gtmFlagged: [],
    priorException: [],
    humanReview: [],
    excluded: [],
  };

  for (const row of results) {
    for (const [tab, classifications] of Object.entries(TAB_CLASSIFICATIONS)) {
      if ((classifications as string[]).includes(row.classification)) {
        tabs[tab].push(row);
        break;
      }
    }
  }

  // For on-demand runs: sort Direct Remove by lowest recent activity first
  // (longest inactive = lowest risk = hit the minimum target fastest)
  tabs['directRemove'].sort((a, b) => {
    const aDate = a.sfLastActivityDate ?? a.lastActivityDate ?? '';
    const bDate = b.sfLastActivityDate ?? b.lastActivityDate ?? '';
    return aDate.localeCompare(bDate); // ascending — oldest first
  });

  return tabs;
}

export default router;
