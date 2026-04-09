/**
 * emailNormalizer.ts
 *
 * Resolves every usage platform user to a canonical @company.com email so they can
 * be joined against the HR system export.
 *
 * Five failure modes handled:
 *   1. Instance domain suffix in userName   e.g. david@company.com.instanceb
 *   2. Non-company domain                   e.g. sarah@legacy.com
 *   3. Plus-addressing alias                e.g. user+tag@company.com
 *   4. Username ≠ actual name format        falls through to Tier 3 name match
 *   5. Non-standard username format          falls through to Tier 3 name match
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Raw row from the usage platform CSV (fields relevant to normalization) */
export interface UsageRow {
  salesforce_email: string;
  salesforce_userName: string;
  first_name: string;
  last_name: string;
}

/** Minimal HR system row shape needed for matching */
export interface HrRow {
  'Work Email': string;
  'Full Name': string;
  'First Name': string;
  'Last Name': string;
  'Active/Inactive Status': string;
  'Termination Date': string;
  'Acquisition Company': string;
  [key: string]: string; // remaining fields passed through to enrichment
}

export type MatchTier = 1 | 3;

export type NormalizationStatus =
  | 'MATCHED'
  | 'INTEGRATION'
  | 'EX_EMPLOYEE'
  | 'LEGACY_UNRESOLVED'
  | 'AMBIGUOUS'
  | 'UNRESOLVED';

export interface NormalizationResult {
  status: NormalizationStatus;
  /** The canonical @company.com email used for the join (present on MATCHED) */
  canonicalEmail?: string;
  /** The HR record that was matched (present on MATCHED) */
  hrRecord?: HrRow;
  /** Which normalization candidate succeeded (present on MATCHED) */
  matchedCandidate?: 'A' | 'B' | 'C' | 'D' | 'E';
  /** Tier 1 = email match; Tier 3 = name match (present on MATCHED) */
  matchTier?: MatchTier;
  /** Set to true when a Tier 3 name match was used — analyst should verify */
  nameMatchFlag?: boolean;
}

// ─── Integration user patterns (ARCHITECTURE.md §3) ──────────────────────────

const INTEGRATION_PATTERNS: string[] = [
  'integration',
  'api-user',
  'bot',
  'system',
  'service',
  'data.integrations',
  'connector',
  'automation',
];

/** Returns true if the email or userName matches any known integration pattern */
export function isIntegrationUser(email: string, userName: string): boolean {
  const haystack = `${email} ${userName}`.toLowerCase();
  return INTEGRATION_PATTERNS.some((p) => haystack.includes(p));
}

// ─── Instance suffix stripping (failure mode 1) ───────────────────────────────

const INSTANCE_SUFFIXES = ['.instanceb', '.instancec', '.instanced', '.instancee'];

/**
 * Strips the instance-domain suffix that Salesforce appends to userNames.
 * "david@company.com.instanceb" → "david@company.com"
 * Returns undefined if no suffix was found (caller falls through).
 */
function stripInstanceSuffix(userName: string): string | undefined {
  const lower = userName.toLowerCase();
  for (const suffix of INSTANCE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return userName.slice(0, userName.length - suffix.length);
    }
  }
  return undefined;
}

// ─── Plus-alias stripping (failure mode 3) ────────────────────────────────────

/**
 * "user+tag@company.com" → "user@company.com"
 * Returns the email unchanged if no plus alias is present.
 */
function stripPlusAlias(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return email;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  const plusIdx = local.indexOf('+');
  return plusIdx === -1 ? email : local.slice(0, plusIdx) + domain;
}

// ─── Domain swap (failure mode 2) ─────────────────────────────────────────────

const COMPANY_DOMAIN = '@company.com';

/**
 * Replaces any non-company domain with @company.com.
 * "sarah@legacy.com" → "sarah@company.com"
 * Returns the email unchanged if it already uses the canonical domain.
 */
function swapDomain(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return email;
  return email.slice(0, atIdx) + COMPANY_DOMAIN;
}

// ─── Candidate builder ────────────────────────────────────────────────────────

interface CandidateSet {
  A: string; // as-is
  B: string; // plus-alias stripped
  C: string | undefined; // instance suffix stripped from userName → @company.com
  D: string; // domain swapped to @company.com
  E: string; // D + plus-alias stripped
}

function buildCandidates(row: UsageRow): CandidateSet {
  const { salesforce_email: email, salesforce_userName: userName } = row;

  const candidateC = stripInstanceSuffix(userName);

  return {
    A: email,
    B: stripPlusAlias(email),
    C: candidateC,
    D: swapDomain(email),
    E: stripPlusAlias(swapDomain(email)),
  };
}

// ─── Lookup maps ──────────────────────────────────────────────────────────────

/** Builds a case-insensitive email → HrRow map from the HR export */
export function buildHrEmailMap(
  hrRows: HrRow[],
): Map<string, HrRow> {
  const map = new Map<string, HrRow>();
  for (const row of hrRows) {
    const email = row['Work Email']?.trim().toLowerCase();
    if (email) map.set(email, row);
  }
  return map;
}

/**
 * Builds a case-insensitive "firstname lastname" → HrRow[] map.
 * Returns arrays so ambiguous (duplicate name) cases can be detected.
 */
export function buildHrNameMap(
  hrRows: HrRow[],
): Map<string, HrRow[]> {
  const map = new Map<string, HrRow[]>();
  for (const row of hrRows) {
    const fullName = row['Full Name']?.trim().toLowerCase();
    if (!fullName) continue;
    const existing = map.get(fullName) ?? [];
    existing.push(row);
    map.set(fullName, existing);
  }
  return map;
}

// ─── Main resolution function ─────────────────────────────────────────────────

/**
 * Resolves a single usage platform row to an HR record (or a failure status).
 *
 * Resolution order:
 *   Step 1 — Integration-user check (before any matching)
 *   Step 2 — Email candidate match (Tier 1) — tries A, B, C, D, E in order
 *   Step 3 — Full name match (Tier 3) — uses first_name + last_name
 *   Step 4 — Failure classification (EX_EMPLOYEE / LEGACY_UNRESOLVED / UNRESOLVED)
 */
export function resolveUser(
  row: UsageRow,
  emailMap: Map<string, HrRow>,
  nameMap: Map<string, HrRow[]>,
): NormalizationResult {
  const { salesforce_email, salesforce_userName, first_name, last_name } = row;

  // Step 1 — Integration user: exclude before any matching
  if (isIntegrationUser(salesforce_email, salesforce_userName)) {
    return { status: 'INTEGRATION' };
  }

  // Step 2 — Email candidate matching (Tier 1)
  const candidates = buildCandidates(row);
  const candidateKeys = ['A', 'B', 'C', 'D', 'E'] as const;

  for (const key of candidateKeys) {
    const candidate = candidates[key];
    if (!candidate) continue; // C can be undefined if no suffix found

    const match = emailMap.get(candidate.toLowerCase());
    if (match) {
      return {
        status: 'MATCHED',
        canonicalEmail: match['Work Email'],
        hrRecord: match,
        matchedCandidate: key,
        matchTier: 1,
      };
    }
  }

  // Step 3 — Full name match (Tier 3)
  // Use directory firstName/lastName directly — reliable even when email format differs
  const firstName = first_name?.trim() ?? '';
  const lastName = last_name?.trim() ?? '';

  if (firstName && lastName) {
    const nameKey = `${firstName} ${lastName}`.toLowerCase();
    const nameMatches = nameMap.get(nameKey);

    if (nameMatches && nameMatches.length === 1) {
      return {
        status: 'MATCHED',
        canonicalEmail: nameMatches[0]['Work Email'],
        hrRecord: nameMatches[0],
        matchTier: 3,
        nameMatchFlag: true, // analyst should verify
      };
    }

    if (nameMatches && nameMatches.length > 1) {
      // Multiple people share the same name — cannot safely resolve
      return { status: 'AMBIGUOUS' };
    }
  }

  // Step 4 — Not found: classify the failure type
  // Broad search: try to find any HR record that hints at this person
  const emailLocalPart = salesforce_email.split('@')[0]?.toLowerCase() ?? '';

  // Check every HR record for a domain-swapped or partial match
  // (lightweight heuristic — not a full fuzzy match)
  for (const [, hrRow] of emailMap) {
    const hrLocal = hrRow['Work Email'].split('@')[0]?.toLowerCase() ?? '';
    if (emailLocalPart && hrLocal === emailLocalPart) {
      // Found a record but couldn't fully resolve — check employment status
      const isTerminated =
        hrRow['Termination Date']?.trim().length > 0 ||
        hrRow['Active/Inactive Status']?.trim().toLowerCase() === 'inactive';

      if (isTerminated) return { status: 'EX_EMPLOYEE' };

      const hasLegacyCompany = hrRow['Acquisition Company']?.trim().length > 0;
      if (hasLegacyCompany) return { status: 'LEGACY_UNRESOLVED' };
    }
  }

  return { status: 'UNRESOLVED' };
}
