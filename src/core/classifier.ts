/**
 * classifier.ts
 *
 * Deterministic pre-classification pass. Applies all rule-based logic before
 * the AI reasoning engine adds reasoning + confidence. The reasoning engine
 * validates and narrates these decisions.
 *
 * Classification order (strict precedence):
 *   1. Excluded — new user (createdDate < 30 days)
 *   2. Excluded — integration account
 *   3. Ex-Employee — unmatched + terminated/inactive in HR system
 *   4. Human Review — ambiguous name match or unresolved
 *   5. Prior Exception — in exception register and meets inactivity criteria
 *   6. Human Review — Protected department (non-GTM, never actioned)
 *   7. GTM determination (4-layer framework)
 *      → Cross-Instance Anomaly — GTM + non-matching product (non-Core)
 *      → GTM — Consult Required — GTM + inactive
 *   8. Inactivity analysis → Direct Remove | Notify First | Human Review
 */

import type { EnrichedUser } from './hrEnricher';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Classification =
  | 'Direct Remove'
  | 'Notify First'
  | 'Ex-Employee'
  | 'GTM — Consult Required'
  | 'Cross-Instance Anomaly'
  | 'Prior Exception'
  | 'Human Review'
  | 'Excluded'
  | 'Unresolved';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type CleanupMode = 'standard' | 'urgent' | 'critical';

export type SfInstance =
  | 'Instance A'
  | 'Instance B'
  | 'Instance C'
  | 'Instance D'
  | 'Instance E';

export interface PriorExceptionRecord {
  userEmail: string;
  userName: string;
  justification: string;
  action: 'keep_flag' | 'remove_with_confirmation';
}

export interface ClassifierConfig {
  instance: SfInstance;
  mode: CleanupMode;
  /** Run date — defaults to now() if omitted (injectable for testing) */
  runDate?: Date;
}

/** Deterministic pre-classification result, before AI enrichment */
export interface PreClassification {
  user: EnrichedUser;
  classification: Classification;
  /** Short deterministic reasoning for the reasoning engine to expand */
  deterministicReason: string;
  /** GTM determination result */
  gtmStatus: GtmStatus;
  /** Activity analysis result */
  activitySignal: ActivitySignal;
  /** Whether user matched a prior exception record */
  isPriorException: boolean;
  priorExceptionRecord?: PriorExceptionRecord;
  /** Whether this is a Tier 3 name match (flagged for analyst verification) */
  nameMatchFlag: boolean;
}

// ─── GTM status ───────────────────────────────────────────────────────────────

export type GtmStatus =
  | 'GTM'
  | 'NON_GTM'
  | 'PAYMENTS_SUPPORT'
  | 'CROSS_INSTANCE_ANOMALY'
  | 'UNKNOWN'; // unresolvable from available data — defaults to Human Review

// ─── Instance product mapping ─────────────────────────────────────────────────

const INSTANCE_PRODUCT_MAP: Record<SfInstance, string[] | null> = {
  'Instance A': null,             // no product filter — all products expected
  'Instance B': ['Product B'],
  'Instance C': ['Product C'],
  'Instance D': ['Product D'],
  'Instance E': ['Product E'],
};

// ─── GTM title lists (Layer 3) ────────────────────────────────────────────────

const GTM_TITLE_KEYWORDS = [
  'account manager',
  'account executive',
  'account management',
  'client success',
  'customer success',
  'implementation consultant',
  'implementation manager',
  'launch',
  'onboarding',
  'trainer',
  'client trainer',
  'solutions consultant',
  'technical consultant',
  'strategic implementation',
  'field implementation',
  'engagement',
  'industry advocacy',
  'product specialist',
  'revenue',
  'gtm',
  'partner',
];

const NON_GTM_TITLE_KEYWORDS = [
  'support specialist',
  'support associate',
  'support manager',
  'support representative',
  'technical support',
];

// ─── GTM 4-layer decision framework ──────────────────────────────────────────

/**
 * Applies the 4-layer GTM decision framework.
 *
 * Layer 1 — Division
 * Layer 2 — Department (Customers division only)
 * Layer 3 — Business Title scan (ambiguous departments)
 * Layer 4 — Instance product alignment (non-Core only)
 */
function determineGtmStatus(user: EnrichedUser, instance: SfInstance): GtmStatus {
  const division = user.division.trim().toLowerCase();
  const department = user.department.trim().toLowerCase();
  const title = user.businessTitle.trim().toLowerCase();
  const product = user.product.trim();

  // Layer 1 — Division
  // Sales division = GTM for all departments.
  // Note: some operations-adjacent teams may fall under Sales — treat as GTM.
  if (division === 'sales') {
    return applyProductAlignment('GTM', product, instance);
  }

  if (
    division === 'ceo' ||
    division === 'marketing' ||
    division === 'operations' ||
    division === 'product' ||
    division === 'technology'
  ) {
    return applyProductAlignment('NON_GTM', product, instance);
  }

  // Layer 2 — Department (Customers division only)
  if (division === 'customers') {
    if (department === 'support') {
      return applyProductAlignment('NON_GTM', product, instance);
    }

    // Protected departments — configurable per deployment.
    // These are non-GTM but must never be directly actioned (always Human Review).
    const protectedDepartments = ['payments support'];
    if (protectedDepartments.includes(department)) {
      return 'PAYMENTS_SUPPORT';
    }

    // Ambiguous Customers departments → Layer 3 title scan
    if (
      department === 'engagement' ||
      department === 'field support' ||
      department === 'launch services' ||
      department === 'professional services'
    ) {
      return layer3TitleScan(title, product, instance);
    }

    // Unknown department within Customers — conservative: title scan
    return layer3TitleScan(title, product, instance);
  }

  // Unknown division — cannot determine GTM status
  return 'UNKNOWN';
}

function layer3TitleScan(title: string, product: string, instance: SfInstance): GtmStatus {
  for (const kw of GTM_TITLE_KEYWORDS) {
    if (title.includes(kw)) {
      return applyProductAlignment('GTM', product, instance);
    }
  }
  for (const kw of NON_GTM_TITLE_KEYWORDS) {
    if (title.includes(kw)) {
      return applyProductAlignment('NON_GTM', product, instance);
    }
  }
  // Unrecognised title — conservative: Human Review via UNKNOWN
  return 'UNKNOWN';
}

/**
 * Layer 4 — Instance product alignment (non-Core instances only).
 *
 * GTM + matching product  → GTM (standard protection)
 * GTM + non-matching      → CROSS_INSTANCE_ANOMALY (Human Review / GTM Flagged)
 * Non-GTM + any product   → NON_GTM (product mismatch is a priority signal in
 *                            the reasoning engine, not a separate classification)
 */
function applyProductAlignment(
  baseStatus: 'GTM' | 'NON_GTM',
  product: string,
  instance: SfInstance,
): GtmStatus {
  const expectedProducts = INSTANCE_PRODUCT_MAP[instance];
  if (expectedProducts === null) {
    // Instance A — no product filter
    return baseStatus;
  }

  const productMatches =
    !product || expectedProducts.some((p) => product.trim() === p);

  if (baseStatus === 'GTM' && !productMatches) {
    return 'CROSS_INSTANCE_ANOMALY';
  }

  return baseStatus;
}

// ─── Activity signal analysis ─────────────────────────────────────────────────

export interface ActivitySignal {
  isActive: boolean;
  isDiscrepant: boolean;
  daysSinceActivity: number | null; // null = no reliable date available
  /** The primary date field used (instance-appropriate) */
  primaryDateUsed: string;
  notes: string;
}

const STANDARD_THRESHOLD_DAYS = 60;
const URGENT_THRESHOLD_DAYS = 30;

/**
 * Parses a date string (ISO or M/D/YYYY) to a Date, returns null if invalid.
 */
function parseActivityDate(value: string): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? null : d;
}

function daysSince(date: Date, runDate: Date): number {
  return Math.floor((runDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Analyses activity signals for a user, applying the instance-specific
 * field hierarchy.
 *
 * Instance A: lastActivityDate + monthlyActivity are unreliable (integration skew).
 *             Use sfLastActivityDate, platformLastDate,
 *             and platformDaysActive as primary.
 *
 * All other instances: all 6 fields are reliable.
 */
function analyseActivity(
  user: EnrichedUser,
  instance: SfInstance,
  mode: CleanupMode,
  runDate: Date,
): ActivitySignal {
  const isSfCore = instance === 'Instance A';

  const sfLastDate = parseActivityDate(user.sfLastActivityDate);
  const platformLastDate = parseActivityDate(user.platformLastDate);
  const sfDays = user.sfDaysActive;
  const platformDays = user.platformDaysActive;

  // For non-Core, also consider the top-level fields
  const lastActivityDate = isSfCore ? null : parseActivityDate(user.lastActivityDate);
  const monthlyActivity = isSfCore ? null : user.monthlyActivity;

  const thresholdDays =
    mode === 'standard' ? STANDARD_THRESHOLD_DAYS
    : mode === 'urgent' ? URGENT_THRESHOLD_DAYS
    : null; // critical = no threshold (all users in scope)

  // Determine the oldest reliable last-activity date
  const candidateDates = [sfLastDate, platformLastDate, lastActivityDate].filter(
    (d): d is Date => d !== null,
  );

  const mostRecentDate =
    candidateDates.length > 0
      ? candidateDates.reduce((latest, d) => (d > latest ? d : latest))
      : null;

  const daysSinceActivity = mostRecentDate ? daysSince(mostRecentDate, runDate) : null;

  // Discrepancy detection: one date/count says active, another says inactive
  const activeDates = candidateDates.filter(
    (d) => thresholdDays === null || daysSince(d, runDate) < thresholdDays,
  );
  const inactiveDates = candidateDates.filter(
    (d) => thresholdDays !== null && daysSince(d, runDate) >= thresholdDays,
  );

  const highDaysActive =
    (sfDays !== null && sfDays > 0) ||
    (platformDays !== null && platformDays > 0) ||
    (monthlyActivity !== null && monthlyActivity > 0);

  const zeroDaysActive =
    (sfDays === null || sfDays === 0) &&
    (platformDays === null || platformDays === 0) &&
    (monthlyActivity === null || monthlyActivity === 0);

  // Discrepancy: mixed signals across date fields or between dates and DaysActive
  const isDiscrepant =
    (activeDates.length > 0 && inactiveDates.length > 0) ||
    (highDaysActive && inactiveDates.length > 0) ||
    (!highDaysActive && activeDates.length > 0 && zeroDaysActive);

  // Permission sets as engagement signal (especially for Instance A)
  const hasPermissionSets =
    user.permissionSets?.trim().length > 0 &&
    user.permissionSets.trim() !== '[]' &&
    user.permissionSets.trim() !== '';

  // Active = within threshold OR has recent DaysActive > 0
  const withinThreshold =
    thresholdDays === null ||
    (daysSinceActivity !== null && daysSinceActivity < thresholdDays);

  const isActive =
    withinThreshold &&
    (highDaysActive ||
      (thresholdDays !== null && daysSinceActivity !== null && daysSinceActivity < thresholdDays));

  const primaryDateUsed = isSfCore
    ? 'salesforce_salesforceLastActivityDate / salesforce_platformLastActivityDate'
    : 'salesforce_lastActivityDate / salesforce_salesforceLastActivityDate / salesforce_platformLastActivityDate';

  const notes = [
    isSfCore ? 'Instance A: top-level activity fields deprioritised (integration skew).' : '',
    isDiscrepant ? 'Activity signal discrepancy detected — mixed date and DaysActive signals.' : '',
    hasPermissionSets && !isActive ? 'Permission sets populated — possible engagement despite inactive dates.' : '',
    daysSinceActivity !== null ? `Days since most recent primary activity: ${daysSinceActivity}.` : 'No primary activity date available.',
    `sfDaysActive=${sfDays ?? 'null'}, platformDaysActive=${platformDays ?? 'null'}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return { isActive, isDiscrepant, daysSinceActivity, primaryDateUsed, notes };
}

// ─── New user exclusion ───────────────────────────────────────────────────────

function isNewUser(sfCreatedDate: string, runDate: Date): boolean {
  if (!sfCreatedDate?.trim()) return false;
  const created = parseActivityDate(sfCreatedDate);
  if (!created) return false;
  return daysSince(created, runDate) < 30;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classifies a single enriched user deterministically.
 * Precedence is strictly top-down — first matching rule wins.
 */
export function classifyUser(
  user: EnrichedUser,
  config: ClassifierConfig,
  priorExceptions: PriorExceptionRecord[],
): PreClassification {
  const runDate = config.runDate ?? new Date();
  const { instance, mode } = config;

  const nameMatchFlag = user.normalization.nameMatchFlag ?? false;

  // ── 1. New user exclusion (before anything else)
  if (isNewUser(user.sfCreatedDate, runDate)) {
    return {
      user,
      classification: 'Excluded',
      deterministicReason: `New user — created within last 30 days (${user.sfCreatedDate}). Excluded from analysis entirely.`,
      gtmStatus: 'UNKNOWN',
      activitySignal: { isActive: true, isDiscrepant: false, daysSinceActivity: null, primaryDateUsed: '', notes: 'New user — not assessed.' },
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 2. Integration user exclusion (normalization already identified these)
  if (user.normalization.status === 'INTEGRATION') {
    return {
      user,
      classification: 'Excluded',
      deterministicReason: `Integration/service account — excluded from analysis. Matched integration pattern.`,
      gtmStatus: 'UNKNOWN',
      activitySignal: { isActive: true, isDiscrepant: false, daysSinceActivity: null, primaryDateUsed: '', notes: 'Integration account.' },
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 3. Ex-employee (unmatched + terminated/inactive)
  if (user.normalization.status === 'EX_EMPLOYEE') {
    return {
      user,
      classification: 'Ex-Employee',
      deterministicReason: `User not found in HR system active roster — employment status indicates termination or inactive. Offboarding failure — priority removal.`,
      gtmStatus: 'UNKNOWN',
      activitySignal: { isActive: false, isDiscrepant: false, daysSinceActivity: null, primaryDateUsed: '', notes: 'Ex-employee — not in HR system.' },
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 4. Ambiguous / Unresolved — cannot safely classify
  if (
    user.normalization.status === 'AMBIGUOUS' ||
    user.normalization.status === 'UNRESOLVED' ||
    user.normalization.status === 'LEGACY_UNRESOLVED'
  ) {
    const reason =
      user.normalization.status === 'AMBIGUOUS'
        ? 'Multiple HR system records share this name — cannot resolve safely. Human verification required.'
        : user.normalization.status === 'LEGACY_UNRESOLVED'
        ? 'Legacy acquired-company account — email format could not be resolved to a current HR system record. Human verification required.'
        : 'Could not match this user to a HR system record. Human verification required.';

    return {
      user,
      classification: 'Unresolved',
      deterministicReason: reason,
      gtmStatus: 'UNKNOWN',
      activitySignal: { isActive: false, isDiscrepant: false, daysSinceActivity: null, primaryDateUsed: '', notes: 'Unresolved.' },
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── From here on, user is MATCHED to HR system ─────────────────────────────

  // Check if HR system shows terminated/inactive despite being matched
  // (can happen with Tier 3 name matches resolving to a terminated employee)
  if (
    user.terminationDate?.trim() ||
    user.activeStatus?.trim().toLowerCase() === 'inactive'
  ) {
    return {
      user,
      classification: 'Ex-Employee',
      deterministicReason: `HR system record shows ${user.terminationDate ? `termination date ${user.terminationDate}` : 'inactive status'}. Offboarding failure — priority removal.`,
      gtmStatus: 'UNKNOWN',
      activitySignal: { isActive: false, isDiscrepant: false, daysSinceActivity: null, primaryDateUsed: '', notes: 'Terminated in HR system.' },
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 5. Prior exception register check
  const canonicalEmail = user.email.toLowerCase();
  const exception = priorExceptions.find(
    (e) => e.userEmail.toLowerCase() === canonicalEmail,
  );

  // Analyse activity signals (needed for exception + GTM inactivity checks)
  const activitySignal = analyseActivity(user, instance, mode, runDate);

  if (exception && !activitySignal.isActive) {
    return {
      user,
      classification: 'Prior Exception',
      deterministicReason: `User is in prior exception register. Justification: "${exception.justification}". Meets inactivity criteria but must not be auto-actioned. Human decides.`,
      gtmStatus: determineGtmStatus(user, instance),
      activitySignal,
      isPriorException: true,
      priorExceptionRecord: exception,
      nameMatchFlag,
    };
  }

  // ── 6. GTM determination (4-layer framework)
  const gtmStatus = determineGtmStatus(user, instance);

  // Protected department — non-GTM, always Human Review
  if (gtmStatus === 'PAYMENTS_SUPPORT') {
    return {
      user,
      classification: 'Human Review',
      deterministicReason: `Protected department — verify access requirement before actioning. Non-GTM but never directly actioned.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // Unknown GTM status — can't safely classify
  if (gtmStatus === 'UNKNOWN') {
    return {
      user,
      classification: 'Human Review',
      deterministicReason: `GTM status could not be determined from available data (division: "${user.division}", department: "${user.department}", title: "${user.businessTitle}"). Human verification required.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 7. Discrepant activity signals → Human Review
  if (activitySignal.isDiscrepant) {
    return {
      user,
      classification: 'Human Review',
      deterministicReason: `Discrepant activity signals — ${activitySignal.notes} Cannot auto-classify in either direction.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 8. Active users → retain (no classification for removal)
  if (activitySignal.isActive) {
    return {
      user,
      classification: 'Excluded',
      deterministicReason: `User is active within the ${mode} mode threshold. No action required.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 9. Inactive from here on ──────────────────────────────────────────────

  // Cross-instance anomaly — GTM user whose product doesn't match this instance
  if (gtmStatus === 'CROSS_INSTANCE_ANOMALY') {
    return {
      user,
      classification: 'Cross-Instance Anomaly',
      deterministicReason: `GTM user (${user.division} / ${user.department}) whose HR system product "${user.product}" does not match the expected product for ${instance}. Verify business need.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // GTM user who is inactive → consult required, no direct action
  if (gtmStatus === 'GTM') {
    return {
      user,
      classification: 'GTM — Consult Required',
      deterministicReason: `GTM user (${user.division} / ${user.department} / "${user.businessTitle}") — inactive per ${mode} mode threshold (${activitySignal.daysSinceActivity ?? 'unknown'} days). GTM always requires manager consultation regardless of mode.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  // ── 10. Non-GTM inactive user — Direct Remove or Notify First
  //
  // Current principle (RULES_DECISION_TABLE.md §12):
  //   Clear inactivity, standard departments → Direct Remove
  //   Borderline inactivity → Notify First
  //
  // "Borderline" = inactive per threshold but sfDaysActive or platformDaysActive
  //   shows some non-zero activity in the 90-day window (ambiguous signal).
  const hasSomeDaysActive =
    (user.sfDaysActive !== null && user.sfDaysActive > 0) ||
    (user.platformDaysActive !== null && user.platformDaysActive > 0);

  const hasPermissionSets =
    user.permissionSets?.trim().length > 0 &&
    user.permissionSets.trim() !== '[]';

  const borderline = hasSomeDaysActive || hasPermissionSets;

  if (borderline) {
    return {
      user,
      classification: 'Notify First',
      deterministicReason: `Non-GTM user is inactive per ${mode} mode threshold (${activitySignal.daysSinceActivity ?? 'unknown'} days) but has borderline activity signals (sfDaysActive=${user.sfDaysActive}, platformDaysActive=${user.platformDaysActive}, permissionSets=${user.permissionSets ? 'populated' : 'empty'}). Notify before removing.`,
      gtmStatus,
      activitySignal,
      isPriorException: false,
      nameMatchFlag,
    };
  }

  return {
    user,
    classification: 'Direct Remove',
    deterministicReason: `Non-GTM user. Inactive per ${mode} mode threshold (${activitySignal.daysSinceActivity ?? 'unknown'} days). Both date fields old and DaysActive = 0. No permission sets. Full removal criteria met.`,
    gtmStatus,
    activitySignal,
    isPriorException: false,
    nameMatchFlag,
  };
}

// ─── Batch classify all users ─────────────────────────────────────────────────

/**
 * Classifies every user in the enriched list and returns the full
 * pre-classification array, ready for the reasoning engine.
 */
export function classifyAll(
  users: EnrichedUser[],
  config: ClassifierConfig,
  priorExceptions: PriorExceptionRecord[],
): PreClassification[] {
  return users.map((u) => classifyUser(u, config, priorExceptions));
}
