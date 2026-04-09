/**
 * hrEnricher.ts
 *
 * Responsibilities:
 *  1. Parse both usage platform and HR system CSVs (csv-parse, header mode)
 *  2. Build email + name lookup maps from the HR export
 *  3. Run the email normalization cascade for every usage platform row
 *  4. Return a typed EnrichedUser[] — the canonical input shape for the
 *     classifier and reasoning engine
 *
 * The HR system is the authoritative source for ALL employee fields — always
 * overrides any corresponding directory/usage platform values.
 */

import { parse } from 'csv-parse/sync';
import {
  buildHrEmailMap,
  buildHrNameMap,
  resolveUser,
  type HrRow,
  type UsageRow,
  type NormalizationResult,
} from './emailNormalizer';

// ─── Full usage platform row ─────────────────────────────────────────────────

export interface FullUsageRow extends UsageRow {
  // Identity
  directory_department: string;
  inEmployeeRoster: string; // DEPRECATED — never use for logic (unreliable)

  // Salesforce metadata
  salesforce_active: string;
  salesforce_isPaidUser: string;
  salesforce_licenseNames: string;
  salesforce_externalUserId: string;
  salesforce_city: string;
  salesforce_state: string;
  salesforce_department: string;
  salesforce_userLocale: string;
  salesforce_profile: string;
  salesforce_userRoleId: string;
  salesforce_role: string;
  salesforce_userType: string;
  salesforce_lightningUser: string;
  salesforce_createdDate: string;
  salesforce_permissionSetsName: string;
  salesforce_permissionSetsLabel: string;
  salesforce_featureLicenses: string;
  salesforce_userLicense: string;
  salesforce_permissionSetLicenses: string;
  salesforce_packageLicenses: string;

  // Activity fields
  salesforce_lastActivityDate: string;          // UNRELIABLE for Instance A (integration skew)
  salesforce_monthlyActivity: string;           // UNRELIABLE for Instance A (integration skew)
  salesforce_salesforceLastActivityDate: string; // PRIMARY — core CRM activity date
  salesforce_salesforceDaysActiveOfLast: string; // PRIMARY — days active on core CRM (90-day window)
  salesforce_platformLastActivityDate: string;   // PRIMARY — standard object activity date
  salesforce_platformDaysActiveOfLast: string;   // PRIMARY — days active on standard objects (90-day window)
}

// ─── Full HR system row (all analysis-relevant fields) ──────────────────────

export interface FullHrRow extends HrRow {
  'On Leave': string;
  'Business Title': string;
  'Division': string;
  'Department': string;
  "Manager's Work Email": string;
  'Region': string;
  'Product': string;
  'Worker Type': string;
  'Worker Sub-Type': string;
  'Hire Date': string;
  'Employee ID': string;
  'Position': string;
  'Management Level': string;
  'People Manager': string;
}

// ─── EnrichedUser — canonical shape flowing into classifier + reasoning ───────

export interface EnrichedUser {
  // ── Normalization metadata
  normalization: NormalizationResult;

  // ── Canonical identity (from HR system when matched; from usage platform when unmatched)
  email: string;
  fullName: string;

  // ── HR system fields (authoritative) — empty strings when unmatched
  department: string;
  division: string;
  businessTitle: string;
  region: string;
  product: string;
  managerEmail: string;
  onLeave: string;
  workerType: string;
  workerSubType: string;
  acquisitionCompany: string;
  hireDate: string;
  activeStatus: string;         // "Active" | "Inactive"
  terminationDate: string;

  // ── Activity fields (from usage platform export)
  sfCreatedDate: string;
  lastActivityDate: string;
  monthlyActivity: number | null;
  sfLastActivityDate: string;
  sfDaysActive: number | null;
  platformLastDate: string;
  platformDaysActive: number | null;

  // ── Metadata (from usage platform export)
  permissionSets: string;       // raw JSON-ish string from usage platform
  profile: string;
  sfActive: string;
  sfIsPaidUser: string;
  sfUserType: string;
  sfLicenseNames: string;
  sfRole: string;
  sfDepartment: string;         // Platform-side dept — HR system dept overrides for logic

  // ── Sporadic flag context (populated during pipeline, not enrichment)
  sporadicFlag?: {
    active: boolean;
    note: string;
    removalCount: number;
    lastRemovedAt: string | null;
    lastReappearedAt: string | null;
    flaggedBy: string;
    flaggedAt: string;
  };
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/** Parse a Buffer or string as CSV, returning an array of header-keyed objects */
function parseCsv<T>(input: Buffer | string): T[] {
  return parse(input, {
    columns: true,         // use first row as header
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as T[];
}

/** Parse usage platform export CSV */
export function parseUsageCsv(input: Buffer | string): FullUsageRow[] {
  return parseCsv<FullUsageRow>(input);
}

/** Parse HR system export CSV */
export function parseHrCsv(input: Buffer | string): FullHrRow[] {
  return parseCsv<FullHrRow>(input);
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Deduplicates usage platform rows by salesforce_email (case-insensitive).
 * Integration connector accounts may appear multiple times — keep first.
 */
export function deduplicateUsageRows(rows: FullUsageRow[]): FullUsageRow[] {
  const seen = new Set<string>();
  const result: FullUsageRow[] = [];
  for (const row of rows) {
    const key = row.salesforce_email?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

// ─── Field coercions ──────────────────────────────────────────────────────────

function toIntOrNull(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

function str(value: string | undefined): string {
  return value?.trim() ?? '';
}

// ─── Enrich a single usage platform row against a resolved HR record ─────────

function buildEnrichedUser(
  usage: FullUsageRow,
  normalization: NormalizationResult,
): EnrichedUser {
  const hr = normalization.hrRecord as FullHrRow | undefined;

  return {
    normalization,

    // Canonical identity — prefer HR system when available
    email: str(hr?.['Work Email']) || str(usage.salesforce_email),
    fullName: str(hr?.['Full Name']) || `${str(usage.first_name)} ${str(usage.last_name)}`.trim(),

    // HR system fields (authoritative)
    department: str(hr?.['Department']),
    division: str(hr?.['Division']),
    businessTitle: str(hr?.['Business Title']),
    region: str(hr?.['Region']),
    product: str(hr?.['Product']),
    managerEmail: str(hr?.["Manager's Work Email"]),
    onLeave: str(hr?.['On Leave']),
    workerType: str(hr?.['Worker Type']),
    workerSubType: str(hr?.['Worker Sub-Type']),
    acquisitionCompany: str(hr?.['Acquisition Company']),
    hireDate: str(hr?.['Hire Date']),
    activeStatus: str(hr?.['Active/Inactive Status']),
    terminationDate: str(hr?.['Termination Date']),

    // Usage platform activity fields
    sfCreatedDate: str(usage.salesforce_createdDate),
    lastActivityDate: str(usage.salesforce_lastActivityDate),
    monthlyActivity: toIntOrNull(usage.salesforce_monthlyActivity),
    sfLastActivityDate: str(usage.salesforce_salesforceLastActivityDate),
    sfDaysActive: toIntOrNull(usage.salesforce_salesforceDaysActiveOfLast),
    platformLastDate: str(usage.salesforce_platformLastActivityDate),
    platformDaysActive: toIntOrNull(usage.salesforce_platformDaysActiveOfLast),

    // Usage platform metadata
    permissionSets: str(usage.salesforce_permissionSetsName),
    profile: str(usage.salesforce_profile),
    sfActive: str(usage.salesforce_active),
    sfIsPaidUser: str(usage.salesforce_isPaidUser),
    sfUserType: str(usage.salesforce_userType),
    sfLicenseNames: str(usage.salesforce_licenseNames),
    sfRole: str(usage.salesforce_role),
    sfDepartment: str(usage.salesforce_department),
  };
}

// ─── Main export: enrich all usage platform users against HR system ──────────

export interface EnrichmentResult {
  enrichedUsers: EnrichedUser[];
  /** Count of Tier 3 name-matched users (analyst should verify these) */
  tier3MatchCount: number;
}

/**
 * Parses both CSVs, deduplicates usage platform rows, runs email normalization, and
 * returns a fully enriched user list.
 *
 * @param usageInput Raw usage platform CSV file buffer or string
 * @param hrInput    Raw HR system CSV file buffer or string
 */
export function enrichUsers(
  usageInput: Buffer | string,
  hrInput: Buffer | string,
): EnrichmentResult {
  const rawUsageRows = parseUsageCsv(usageInput);
  const hrRows = parseHrCsv(hrInput);

  const deduped = deduplicateUsageRows(rawUsageRows);

  const emailMap = buildHrEmailMap(hrRows);
  const nameMap = buildHrNameMap(hrRows);

  let tier3MatchCount = 0;
  const enrichedUsers: EnrichedUser[] = [];

  for (const usageRow of deduped) {
    const normalization = resolveUser(usageRow, emailMap, nameMap);
    const user = buildEnrichedUser(usageRow, normalization);
    if (normalization.nameMatchFlag) tier3MatchCount++;
    enrichedUsers.push(user);
  }

  return { enrichedUsers, tier3MatchCount };
}
