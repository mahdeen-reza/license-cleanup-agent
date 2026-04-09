/**
 * foundationalKnowledge.ts
 *
 * Loads the knowledge context injected into every AI classification prompt.
 *
 * Source priority:
 *   1. AccessCriteria record in DB for the given instanceName — human-reviewed,
 *      instance-specific criteria built up over time
 *   2. Hardcoded seed prompt — encodes the core inactivity principles and GTM
 *      framework from CLAUDE.md / RULES_DECISION_TABLE.md. Used on first run
 *      before any criteria have been confirmed.
 *
 * The seed prompt is intentionally comprehensive so first-run quality is high
 * without requiring manual setup.
 */

import { prisma } from '../lib/prisma';

// ─── Seed prompt ──────────────────────────────────────────────────────────────
// This is the fallback used before any per-instance criteria exist in the DB.

const SEED_FOUNDATIONAL_KNOWLEDGE = `
# Salesforce License Clean-Up — Foundational Knowledge

## Purpose
You are classifying Salesforce users for license clean-up. Every user
must be assigned exactly one classification from the 9-category framework below.
Your output will be reviewed by a human analyst before any action is taken.
Be conservative: wrong removals are more costly than missed removals.
Borderline cases always go to Human Review.

## The 9 Classifications
1. Direct Remove       — Inactive non-GTM, full removal criteria met, no exceptions
2. Notify First        — Inactive, borderline signals or department requires notification
3. Ex-Employee         — Terminated or inactive in HR system; offboarding failure
4. GTM — Consult Required — Meets inactivity threshold but is GTM; must consult manager
5. Cross-Instance Anomaly — GTM user whose HR product doesn't match this instance
6. Prior Exception     — Has documented business justification; human decides
7. Human Review        — Borderline, ambiguous, discrepant signals, or protected department
8. Excluded            — Integration/service account or user created within last 30 days
9. Unresolved          — Could not be matched to HR system; manual investigation required

## GTM Decision Framework (4 Layers)

### Layer 1 — Division
- Sales → GTM (all departments)
  Note: Some operations-adjacent teams may fall under Sales — treat as GTM.
- CEO, Marketing, Operations, Product, Technology → Non-GTM
- Customers → proceed to Layer 2

### Layer 2 — Department (Customers division only)
- Support → Non-GTM
- Protected departments (configurable) → always Human Review, never direct action
  Include note: "Protected department — verify access requirement before actioning."
- Engagement, Field Support, Launch Services, Professional Services → proceed to Layer 3

### Layer 3 — Business Title scan (Customers division, ambiguous departments)
GTM titles (consult required before any action):
  Account Manager, Account Executive, Account Management, Client Success,
  Customer Success, Implementation Consultant, Implementation Manager,
  Launch, Onboarding, Trainer, Client Trainer, Solutions Consultant,
  Technical Consultant, Strategic Implementation, Field Implementation,
  Engagement, Industry Advocacy, Product Specialist (customer-facing),
  Revenue, GTM, Partner

Non-GTM titles (proceed to inactivity analysis):
  Support Specialist, Support Associate, Support Manager,
  Support Representative, Technical Support

Unknown/unrecognised titles in ambiguous departments → Human Review

### Layer 4 — Instance product alignment (non-Core instances only)
- GTM + product matches instance's expected product → Standard GTM protection
- GTM + product does NOT match → Cross-Instance Anomaly (Human Review / GTM Flagged)
- Non-GTM + non-matching product → Priority removal candidate
- Instance A → no product filter (all products expected)

## Activity Signal Rules

### Instance A — Integration Skew
Some activity fields may be unreliable for certain instances due to third-party
integrations inflating activity counts. For Instance A, use ONLY:
  - crm_last_activity_date       (core CRM object activity)
  - platform_last_activity_date  (standard object activity)
  - platform_days_active_last_90 (days active, 90-day window)

### All Other Instances
All 6 activity fields are reliable:
  last_activity_date, monthly_logins,
  crm_last_activity_date, crm_days_active_last_90,
  platform_last_activity_date, platform_days_active_last_90

### DaysActive Interpretation
- Value = 0 → zero active days in last 90 days (strong inactivity signal)
- Value = 90 → active every day in last 90 days
- 90-day window confirmed from data

### Combined Signal Decision Logic
- BOTH primary date fields old AND BOTH DaysActive = 0 → Strong inactivity → qualifies for removal
- ONE field recent + high DaysActive / populated permissionSets, OTHER field old → Discrepancy → Human Review
- BOTH fields recent AND DaysActive > 0 → Active user → retain
- Created within last 30 days → Excluded entirely

### Permission Sets as Signal
- permissionSets populated (e.g. ["skuid","CHRGFYNG"]) = meaningful engagement even if dates look borderline → Notify First, not Direct Remove
- permissionSets empty [] + old dates = stronger inactivity signal → Direct Remove

## Conservative Principles
- Wrong removal > missed removal in terms of business cost
- Any uncertainty about employment, GTM status, or activity → Human Review
- Tier 3 name-matched users (email couldn't be resolved, matched by name) → flag as
  "name-match — verify recommended" but proceed with classification if confident
- On Leave users → include in analysis but note in reasoning (activity may be legitimately low)
- Acquisition Company users → may have legacy email formats; classify conservatively

## HR System Authoritative Override
The HR system is the authoritative source for ALL employee data. Always use HR fields for:
- Employment status (Active/Inactive), termination date
- Division, Department, Business Title
- Product (for instance product alignment)
Do NOT use inEmployeeRoster from the usage platform — it is deprecated and unreliable.
Do NOT use directory_department or platform department for GTM logic — use HR system Division/Department.
`.trim();

// ─── DB-backed loader ─────────────────────────────────────────────────────────

/**
 * Loads the foundational knowledge string for a given instance.
 *
 * Looks up AccessCriteria by instanceName. If a record exists and has content,
 * serialises it as a formatted string. Falls back to the seed prompt if no
 * record exists yet.
 */
export async function loadFoundationalKnowledge(instanceName: string): Promise<string> {
  try {
    const criteria = await prisma.accessCriteria.findUnique({
      where: { instanceId: instanceName },
    });

    if (criteria?.content) {
      // Content is stored as a Json field — stringify it into the prompt
      const header = `# Access Criteria — ${criteria.instanceName} (v${criteria.version}, updated by ${criteria.updatedBy})\n\n`;
      const body =
        typeof criteria.content === 'string'
          ? criteria.content
          : JSON.stringify(criteria.content, null, 2);
      return header + body;
    }
  } catch {
    // DB read failure is non-fatal — fall through to seed
  }

  return SEED_FOUNDATIONAL_KNOWLEDGE;
}

/** Exported for seeding new instances and for tests */
export { SEED_FOUNDATIONAL_KNOWLEDGE };
