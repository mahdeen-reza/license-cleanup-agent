/**
 * userHistoryService.ts
 *
 * Assembles a complete per-user timeline for a specific instance. Pulls from
 * five data sources: UserInstanceHistory events, AnalysisResult appearances,
 * SporadicFlag, PriorException, and ChatOverride records.
 */

import { prisma } from '../lib/prisma';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HistoryEvent {
  id: string;
  eventType: string;
  eventDate: string;
  classification?: string | null;
  note?: string | null;
  actorEmail?: string | null;
  runId?: string | null;
  runMode?: string | null;
  runCleanupType?: string | null;
}

export interface AnalysisAppearance {
  runId: string;
  ranAt: string;
  mode: string;
  cleanupType: string;
  classification: string;
  confidenceLevel: string;
  reasoning: string;
  actionStatus: string;
  actionedAt: string | null;
  actionedBy: string | null;
  actionNote: string | null;
  deltaCategory: string | null;
  previousClassification: string | null;
  matchTier: number;
}

export interface UserHistoryResponse {
  userEmail: string;
  instanceName: string;
  events: HistoryEvent[];
  appearances: AnalysisAppearance[];
  sporadicFlag: {
    id: string;
    active: boolean;
    note: string;
    removalCount: number;
    lastRemovedAt: string | null;
    lastReappearedAt: string | null;
    flaggedBy: string;
    flaggedAt: string;
  } | null;
  priorException: {
    justification: string;
    action: string;
    role: string;
  } | null;
  totalAppearances: number;
  totalTimesActioned: number;
  totalTimesDeferred: number;
  firstSeen: string | null;
  lastSeen: string | null;
  systemId: string | null;
}

// ─── Main query ─────────────────────────────────────────────────────────────

export async function getUserHistory(
  userEmail: string,
  instanceName: string,
): Promise<UserHistoryResponse> {
  // Run all queries in parallel
  const [historyEvents, analysisResults, sporadicFlag, chatOverrides, systemId] =
    await Promise.all([
      // 1. UserInstanceHistory events
      prisma.userInstanceHistory.findMany({
        where: { userEmail, instanceName },
        orderBy: { eventDate: 'desc' },
      }),

      // 2. AnalysisResult appearances joined with AnalysisRun
      prisma.analysisResult.findMany({
        where: {
          email: { equals: userEmail, mode: 'insensitive' },
          run: { instanceName },
        },
        include: {
          run: {
            select: {
              id: true,
              ranAt: true,
              mode: true,
              cleanupType: true,
              instanceName: true,
            },
          },
        },
        orderBy: { run: { ranAt: 'desc' } },
      }),

      // 3. SporadicFlag for this user + instance
      prisma.sporadicFlag.findUnique({
        where: { userEmail_instanceName: { userEmail, instanceName } },
      }),

      // 4. ChatOverride records for this user on this instance
      prisma.chatOverride.findMany({
        where: {
          targetUserEmail: { equals: userEmail, mode: 'insensitive' },
          run: { instanceName },
        },
        include: {
          run: { select: { ranAt: true, mode: true, cleanupType: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 5. Resolve systemId for prior exception lookup
      prisma.instanceConfig
        .findFirst({ where: { instanceName }, select: { systemId: true } })
        .then((ic) => ic?.systemId ?? null),
    ]);

  // 6. Prior exception (system-scoped)
  const priorException = systemId
    ? await prisma.priorException.findUnique({
        where: { systemId_userEmail: { systemId, userEmail } },
      })
    : null;

  // ─── Build appearances ───────────────────────────────────────────────────

  const appearances: AnalysisAppearance[] = analysisResults.map((r) => ({
    runId: r.run.id,
    ranAt: r.run.ranAt.toISOString(),
    mode: r.run.mode,
    cleanupType: r.run.cleanupType,
    classification: r.classification,
    confidenceLevel: r.confidenceLevel,
    reasoning: r.reasoning,
    actionStatus: r.actionStatus,
    actionedAt: r.actionedAt?.toISOString() ?? null,
    actionedBy: r.actionedBy ?? null,
    actionNote: r.actionNote ?? null,
    deltaCategory: r.deltaCategory ?? null,
    previousClassification: r.previousClassification ?? null,
    matchTier: r.matchTier,
  }));

  // ─── Build merged timeline ───────────────────────────────────────────────

  // Start with UserInstanceHistory events (already has actioned, deferred,
  // sporadic, reappeared, analysis_run events)
  const eventMap = new Map<string, HistoryEvent>();

  for (const e of historyEvents) {
    eventMap.set(e.id, {
      id: e.id,
      eventType: e.eventType,
      eventDate: e.eventDate.toISOString(),
      classification: e.classification,
      note: e.note,
      actorEmail: e.actorEmail,
      runId: e.runId,
      runMode: null,
      runCleanupType: null,
    });
  }

  // Add chat_override events (may not be in UserInstanceHistory)
  for (const co of chatOverrides) {
    const key = `override_${co.id}`;
    if (!eventMap.has(key)) {
      eventMap.set(key, {
        id: co.id,
        eventType: 'chat_override',
        eventDate: co.createdAt.toISOString(),
        classification: co.newClassification,
        note: `Reclassified from ${co.originalClassification} to ${co.newClassification}: ${co.reason}`,
        actorEmail: co.userEmail,
        runId: co.runId,
        runMode: co.run.mode,
        runCleanupType: co.run.cleanupType,
      });
    }
  }

  // Sort all events reverse chronologically
  const events = Array.from(eventMap.values()).sort(
    (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime(),
  );

  // Enrich events with run metadata where available
  const runLookup = new Map(
    analysisResults.map((r) => [r.run.id, { mode: r.run.mode, cleanupType: r.run.cleanupType }]),
  );
  for (const event of events) {
    if (event.runId && !event.runMode) {
      const runMeta = runLookup.get(event.runId);
      if (runMeta) {
        event.runMode = runMeta.mode;
        event.runCleanupType = runMeta.cleanupType;
      }
    }
  }

  // ─── Summary stats ───────────────────────────────────────────────────────

  const totalAppearances = appearances.length;
  const totalTimesActioned = appearances.filter((a) => a.actionStatus === 'actioned').length;
  const totalTimesDeferred = appearances.filter((a) => a.actionStatus === 'deferred').length;
  const firstSeen = appearances.length > 0 ? appearances[appearances.length - 1].ranAt : null;
  const lastSeen = appearances.length > 0 ? appearances[0].ranAt : null;

  return {
    userEmail,
    instanceName,
    events,
    appearances,
    sporadicFlag: sporadicFlag
      ? {
          id: sporadicFlag.id,
          active: sporadicFlag.active,
          note: sporadicFlag.note,
          removalCount: sporadicFlag.removalCount,
          lastRemovedAt: sporadicFlag.lastRemovedAt?.toISOString() ?? null,
          lastReappearedAt: sporadicFlag.lastReappearedAt?.toISOString() ?? null,
          flaggedBy: sporadicFlag.flaggedBy,
          flaggedAt: sporadicFlag.flaggedAt.toISOString(),
        }
      : null,
    priorException: priorException
      ? {
          justification: priorException.justification,
          action: priorException.action,
          role: priorException.role,
        }
      : null,
    totalAppearances,
    totalTimesActioned,
    totalTimesDeferred,
    firstSeen,
    lastSeen,
    systemId,
  };
}
