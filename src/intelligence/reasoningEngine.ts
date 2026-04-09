/**
 * reasoningEngine.ts
 *
 * Takes the deterministic pre-classifications from classifier.ts and asks
 * the AI model to:
 *   1. Validate or refine the classification (AI can override borderline cases)
 *   2. Assign a confidence level: high | medium | low
 *   3. Write a 1–2 sentence plain English explanation for the analyst
 *
 * The prompt includes:
 *   - Foundational knowledge (loaded from DB or seed)
 *   - Instance configuration (thresholds, product alignment, GTM handling)
 *   - Prior exception register for this instance
 *   - The enriched user data with the deterministic pre-classification
 *
 * Batching: Large instances may have 1000+ users. We batch by BATCH_SIZE to stay
 * within the AI model's token limit. Results from all batches are merged in order.
 */

import { invokeModel, isAIConfigured } from '../lib/ai';
import { loadFoundationalKnowledge } from './foundationalKnowledge';
import type { PreClassification, Classification, ConfidenceLevel, SfInstance, CleanupMode, PriorExceptionRecord } from '../core/classifier';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReasoningResult {
  email: string;
  classification: Classification;
  confidenceLevel: ConfidenceLevel;
  reasoning: string;
}

export interface RunConfig {
  instance: SfInstance;
  mode: CleanupMode;
  cleanupType: 'routine' | 'on_demand';
  licensesNeeded?: number;
}

export interface InstanceConfig {
  instanceName: string;
  defaultScope: string;
  thresholds: { standardDays: number; urgentDays: number };
  productAlignment: { matchingProducts: string[] } | null;
  gtmHandling: string;
}

// ─── Prompt construction ──────────────────────────────────────────────────────

const BATCH_SIZE = 25; // users per AI model call

function buildSystemContext(
  foundationalKnowledge: string,
  instanceConfig: InstanceConfig,
  runConfig: RunConfig,
  priorExceptions: PriorExceptionRecord[],
): string {
  const productNote =
    instanceConfig.productAlignment
      ? `Expected HR product values for ${instanceConfig.instanceName}: ${instanceConfig.productAlignment.matchingProducts.join(', ')}.`
      : `${instanceConfig.instanceName} has no product filter — all products are expected.`;

  const thresholdNote =
    runConfig.mode === 'standard'
      ? `Standard mode: inactivity threshold = ${instanceConfig.thresholds.standardDays} days.`
      : runConfig.mode === 'urgent'
      ? `Urgent mode: inactivity threshold = ${instanceConfig.thresholds.urgentDays} days.`
      : `Critical mode: no inactivity threshold — all users are in scope.`;

  const licensesNote = runConfig.licensesNeeded
    ? `On-demand run: minimum ${runConfig.licensesNeeded} licenses needed. Prioritise lowest-risk removals first.`
    : `Routine run: maximise removals without specific license target.`;

  const exceptionsSection =
    priorExceptions.length > 0
      ? `## Prior Exception Register\nThe following users have documented business justifications. If inactive, classify as "Prior Exception" — do not suggest Direct Remove:\n${priorExceptions
          .map((e) => `- ${e.userEmail} (${e.userName}): ${e.justification} [action: ${e.action}]`)
          .join('\n')}`
      : `## Prior Exception Register\nNo prior exceptions registered for this instance.`;

  return `
${foundationalKnowledge}

---

## Run Configuration
- Instance: ${instanceConfig.instanceName}
- Mode: ${runConfig.mode} — ${thresholdNote}
- Cleanup type: ${runConfig.cleanupType} — ${licensesNote}
- GTM handling: ${instanceConfig.gtmHandling}
- ${productNote}

${exceptionsSection}

---

## Your Task
For each user below, you will receive:
- Their HR system employment and role data (authoritative)
- Their Salesforce activity data
- The deterministic pre-classification assigned by the rules engine

You must return a JSON array with exactly one object per user, in the same order:
{
  "email": "<canonical email>",
  "classification": "<one of the 9 classifications exactly as written>",
  "confidenceLevel": "high" | "medium" | "low",
  "reasoning": "<1-2 sentence plain English explanation for the analyst>"
}

Rules for your output:
- You MAY override the pre-classification if you have strong reasons (explain in reasoning)
- You MUST use the exact classification strings: "Direct Remove", "Notify First",
  "Ex-Employee", "GTM — Consult Required", "Cross-Instance Anomaly",
  "Prior Exception", "Human Review", "Excluded", "Unresolved"
- confidenceLevel guidance:
    high   = clear-cut case, all signals agree, no ambiguity
    medium = mostly clear but one signal is missing or slightly inconsistent
    low    = borderline, multiple interpretations possible
- reasoning must be plain English, factual, defensible — an analyst will read this
  to decide whether to act. Cite the specific signals that drove the classification.
- For Tier 3 name-matched users (nameMatchFlag = true), note "name-match — verify recommended" in reasoning
- For protected department users, include the phrase: "Protected department — verify access requirement before actioning"
- For sporadic/temporary access users (isSporadicFlagged = true): mention the known pattern in reasoning,
  e.g. "Known temporary access — [note]. Removed [N] times previously." The flag does NOT protect them
  from removal — classify normally based on activity, but note the pattern for analyst context.
- Return ONLY valid JSON — no markdown fences, no preamble, no trailing text
`.trim();
}

function buildUserBatchPrompt(batch: PreClassification[]): string {
  const users = batch.map((pc) => ({
    email: pc.user.email,
    fullName: pc.user.fullName,
    division: pc.user.division,
    department: pc.user.department,
    businessTitle: pc.user.businessTitle,
    region: pc.user.region,
    product: pc.user.product,
    workerType: pc.user.workerType,
    onLeave: pc.user.onLeave,
    acquisitionCompany: pc.user.acquisitionCompany || null,
    activeStatus: pc.user.activeStatus,
    terminationDate: pc.user.terminationDate || null,
    // Activity fields
    sfCreatedDate: pc.user.sfCreatedDate,
    lastActivityDate: pc.user.lastActivityDate || null,
    monthlyActivity: pc.user.monthlyActivity,
    sfLastActivityDate: pc.user.sfLastActivityDate || null,
    sfDaysActive: pc.user.sfDaysActive,
    platformLastDate: pc.user.platformLastDate || null,
    platformDaysActive: pc.user.platformDaysActive,
    permissionSets: pc.user.permissionSets || null,
    profile: pc.user.profile || null,
    // Pre-classification context
    preClassification: pc.classification,
    deterministicReason: pc.deterministicReason,
    gtmStatus: pc.gtmStatus,
    activityIsActive: pc.activitySignal.isActive,
    activityIsDiscrepant: pc.activitySignal.isDiscrepant,
    daysSinceActivity: pc.activitySignal.daysSinceActivity,
    activityNotes: pc.activitySignal.notes,
    nameMatchFlag: pc.nameMatchFlag,
    isPriorException: pc.isPriorException,
    priorExceptionJustification: pc.priorExceptionRecord?.justification ?? null,
    // Sporadic flag context — user has known temporary/project-based access pattern
    isSporadicFlagged: !!pc.user.sporadicFlag,
    sporadicNote: pc.user.sporadicFlag?.note ?? null,
    sporadicRemovalCount: pc.user.sporadicFlag?.removalCount ?? 0,
  }));

  return JSON.stringify(users, null, 2);
}

// ─── Response parsing ─────────────────────────────────────────────────────────

const VALID_CLASSIFICATIONS = new Set<string>([
  'Direct Remove',
  'Notify First',
  'Ex-Employee',
  'GTM — Consult Required',
  'Cross-Instance Anomaly',
  'Prior Exception',
  'Human Review',
  'Excluded',
  'Unresolved',
]);

const VALID_CONFIDENCE = new Set<string>(['high', 'medium', 'low']);

interface RawAIResult {
  email?: unknown;
  classification?: unknown;
  confidenceLevel?: unknown;
  reasoning?: unknown;
}

function parseAIResponse(
  raw: string,
  batch: PreClassification[],
): ReasoningResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // AI model occasionally wraps in markdown fences — strip and retry
    const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
    try {
      parsed = JSON.parse(stripped.trim());
    } catch {
      // Full parse failure — fall back to deterministic results for this batch
      return batch.map((pc) => ({
        email: pc.user.email,
        classification: pc.classification,
        confidenceLevel: 'low' as ConfidenceLevel,
        reasoning: `[AI parse error — using deterministic result] ${pc.deterministicReason}`,
      }));
    }
  }

  if (!Array.isArray(parsed)) {
    // Unexpected shape — fall back
    return batch.map((pc) => ({
      email: pc.user.email,
      classification: pc.classification,
      confidenceLevel: 'low' as ConfidenceLevel,
      reasoning: `[AI response malformed — using deterministic result] ${pc.deterministicReason}`,
    }));
  }

  // Map results by email so order mismatches are handled gracefully
  const resultMap = new Map<string, ReasoningResult>();
  for (const item of parsed as RawAIResult[]) {
    const email = typeof item.email === 'string' ? item.email.toLowerCase().trim() : '';
    if (!email) continue;

    const classification = VALID_CLASSIFICATIONS.has(item.classification as string)
      ? (item.classification as Classification)
      : null;

    const confidence = VALID_CONFIDENCE.has(item.confidenceLevel as string)
      ? (item.confidenceLevel as ConfidenceLevel)
      : 'low';

    const reasoning = typeof item.reasoning === 'string' && item.reasoning.trim()
      ? item.reasoning.trim()
      : 'No reasoning provided.';

    if (classification) {
      resultMap.set(email, { email, classification, confidenceLevel: confidence, reasoning });
    }
  }

  // Rebuild in original batch order; fall back to deterministic for any missing user
  return batch.map((pc) => {
    const key = pc.user.email.toLowerCase().trim();
    return (
      resultMap.get(key) ?? {
        email: pc.user.email,
        classification: pc.classification,
        confidenceLevel: 'low' as ConfidenceLevel,
        reasoning: `[No AI result for user — using deterministic result] ${pc.deterministicReason}`,
      }
    );
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs the full reasoning pass over all pre-classified users.
 *
 * Sends users to the AI model in batches of BATCH_SIZE, collects results, and
 * returns a flat ReasoningResult[] in the original input order.
 */
function buildMockResults(preClassifications: PreClassification[]): ReasoningResult[] {
  return preClassifications.map((pc) => ({
    email: pc.user.email,
    classification: 'Human Review' as Classification,
    confidenceLevel: 'low' as ConfidenceLevel,
    reasoning: 'AI provider not configured — manual review required',
  }));
}

export async function runReasoningEngine(
  preClassifications: PreClassification[],
  runConfig: RunConfig,
  instanceConfig: InstanceConfig,
  priorExceptions: PriorExceptionRecord[],
): Promise<ReasoningResult[]> {
  // Check for AI provider credentials before attempting calls
  if (!isAIConfigured()) {
    console.warn('AI provider not configured — using mock fallback (all users → Human Review)');
    return buildMockResults(preClassifications);
  }

  const foundationalKnowledge = await loadFoundationalKnowledge(runConfig.instance);

  const systemContext = buildSystemContext(
    foundationalKnowledge,
    instanceConfig,
    runConfig,
    priorExceptions,
  );

  const results: ReasoningResult[] = [];

  for (let i = 0; i < preClassifications.length; i += BATCH_SIZE) {
    const batch = preClassifications.slice(i, i + BATCH_SIZE);
    const userPayload = buildUserBatchPrompt(batch);

    const prompt = `${systemContext}\n\n## Users (batch ${Math.floor(i / BATCH_SIZE) + 1})\n\n${userPayload}`;

    try {
      const raw = await invokeModel(prompt);
      const batchResults = parseAIResponse(raw, batch);
      results.push(...batchResults);
    } catch (err) {
      console.warn(`AI call failed for batch ${Math.floor(i / BATCH_SIZE) + 1} — using mock fallback:`, err);
      results.push(...buildMockResults(batch));
    }
  }

  return results;
}
