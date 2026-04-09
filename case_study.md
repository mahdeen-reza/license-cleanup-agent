# Building an AI-Powered License Clean-Up Agent

| | |
|---|---|
| **Role** | Solo builder -- architecture through deployment |
| **Timeline** | ~3 months (ongoing) |
| **Stack** | TypeScript, Express 5, React 19, PostgreSQL, Claude API |
| **Status** | Phase 1 complete, Phase 2 infrastructure ready |

---

## The Problem

When a SaaS instance runs out of available license seats, new hire onboarding stops. The only way to free capacity is a clean-up cycle -- identify inactive users, compile a removal list, and submit a support ticket. Before this tool existed, that meant exporting a usage report and an HR employee roster, loading both into a spreadsheet, manually joining them on email (which rarely matched cleanly), applying business rules from memory, and building the removal list row by row.

Each cycle took approximately two hours of focused analytical work and roughly a full business day end-to-end when accounting for competing priorities. There was no audit trail -- no record of who was reviewed, what was decided, or why. Access criteria were undocumented. The entire process relied on tacit knowledge held by one person. And every clean-up started from scratch, with no memory of what happened in the previous cycle.

The operational cost wasn't just analyst time. It was the institutional risk of a process that couldn't be handed off, couldn't be audited, and couldn't learn from its own history.

---

## My Role

I designed and built the entire system end to end -- sole architect, developer, domain expert, and product owner. This was not a delegated engineering task with requirements handed down. I authored the product requirements, defined all business rules and classification logic, designed the database schema and system architecture, built the full-stack application, and deployed it to production.

The domain knowledge -- how clean-ups actually work, what the edge cases are, which mistakes are expensive -- came from doing the manual process myself. The tool encodes that operational experience into a system that can be run by anyone with the right access.

---

## Approach

Before writing any code, I wrote four planning documents that lived in the repository throughout the build:

- **PRD** -- product requirements, user flows, success metrics, and explicit non-goals
- **Architecture doc** -- field schemas, database models, API routes, normalization logic, and intelligence layer design
- **Rules decision table** -- complete classification logic, the department classification framework, activity signal interpretation, and every edge case
- **CLAUDE.md** -- project context file auto-loaded by Claude Code every development session, ensuring the AI assistant never lost context between sessions

This planning-first approach meant that by the time I started building, every classification rule, every edge case, and every data flow was already specified. The documents evolved as the build progressed -- they were living references, not throwaway artifacts.

The design philosophy was conservative throughout: when in doubt, route to Human Review. The cost of incorrectly removing a user (disrupted work, re-provisioning, escalation) always exceeds the cost of leaving one extra license seat occupied.

---

## Architecture

The system is a single-container web application: a React SPA served by Express, with PostgreSQL handling all persistence. The analysis pipeline runs in 16 steps, from CSV parsing through AI reasoning to delta comparison.

### Input Layer

The analyst uploads two CSV files -- a usage platform export (user activity and license data) and an HR system export (employee roster). Files are parsed in memory and never written to disk. The HR system is treated as the authoritative source for all employee information.

### Email Normalization Cascade

A simple email join between the usage export and the HR roster fails in practice. Users appear with instance-specific suffixes, legacy domains from acquisitions, plus-alias variants, and name mismatches. The normalization cascade resolves these through a 5-tier sequence:

1. Direct email match against 5 candidate formats (as-is, plus-alias stripped, instance suffix stripped, domain swapped, domain swapped + plus-alias stripped)
2. Full name match from directory fields as a fallback
3. Failure classification for unresolved cases (ambiguous matches, legacy domains, no match at all)

Every Tier 3 (name-based) match is flagged for human verification -- the system never auto-actions on an ambiguous identity resolution.

### HR Enrichment

Every usage export user gets enriched with full HR context: department, division, business title, product assignment, region, manager, worker type, leave status, employment status, and termination date. This context feeds directly into the classification engine.

### Classification Engine

A deterministic 10-step precedence chain classifies every user before AI sees them. The first matching rule wins:

1. Exclude new users (created within 30 days)
2. Exclude integration/service accounts (pattern matching)
3. Flag ex-employees (HR shows terminated but still in usage platform)
4. Route ambiguous/unresolved matches to Human Review
5. Check prior exception register
6. Route protected departments to Human Review
7. Apply 4-layer department classification framework (Division > Department > Business Title > Product alignment)
8. Flag discrepant activity signals
9. Exclude active users
10. Classify inactive users as Direct Remove or Notify First based on signal strength

The department classification framework protects revenue-facing users through four layers of increasingly specific checks, from broad division-level rules down to individual business title keyword matching and product alignment verification.

### AI Reasoning Engine

The Anthropic Claude API validates and refines deterministic pre-classifications, assigns confidence levels (high, medium, low), and writes a 1-2 sentence plain-English reasoning for every user. Users are batched (25 per API call) to manage token limits. The system context includes foundational knowledge, instance-specific access criteria, and prior exception data.

When no API key is configured, the pipeline runs entirely on the deterministic classifier. Classification still works -- the AI layer adds nuance, not core functionality.

### Delta Analysis

Every run after the first automatically compares against the most recent previous run for the same instance. Each user is tagged with one of five delta categories: newly inactive, persistently inactive, recovered, reappeared, or net new. This means the analyst can prioritize newly inactive users for fresh review while quickly confirming persistently inactive users they've seen before.

### Persistence and Audit Trail

Fourteen Prisma models store the complete history: analysis runs, per-user results, action decisions, user history events, sporadic access flags, prior exceptions, chat overrides, access criteria versions, and conversation history. Every run, every classification, and every analyst decision is recorded with identity and timestamp.

---

## The Hard Problems

### 1. Email Normalization -- Why a Simple Join Doesn't Work

The usage platform and the HR system store emails differently. Users appear with instance-specific suffixes (`user.instanceb@company.com`), legacy domains from acquisitions (`user@acquired-corp.com`), plus-alias variants (`user+tag@company.com`), and sometimes no email match at all -- just a name in a directory field that might correspond to one of several HR records.

A naive `LEFT JOIN ON email` misses roughly 20-30% of users in a typical dataset. The normalization cascade generates up to 5 email candidates per user, tries each against the HR roster, then falls back to name matching. When name matching produces multiple candidates, the system classifies the match as ambiguous and routes to Human Review rather than guessing.

The edge cases compound: an acquired employee with a legacy email, whose name appears twice in the HR roster (two John Smiths), requires the cascade to try domain swapping, fail on ambiguity, and correctly route to manual investigation. The demo data includes these exact scenarios.

### 2. Conservative Classification -- The Cost of a Wrong Removal

Removing the wrong user is expensive. The employee loses access mid-workflow, files a support ticket, the license needs to be re-provisioned, and the clean-up process loses credibility. A missed removal, by contrast, costs one license seat until the next cycle.

This asymmetry drove every design decision in the classification engine. The 10-step precedence chain is ordered from most conservative to least -- new users and integration accounts are excluded before anything else. The department classification framework has four layers specifically to avoid accidentally removing a revenue-facing user. Protected departments always route to Human Review regardless of activity level. And when AI is unavailable, every user is classified as Human Review rather than applying the deterministic rules without a second opinion.

The 9-category output isn't just classification granularity for its own sake -- each category maps to a different action workflow with different risk profiles. Ex-employees get a priority ticket (offboarding failure). Revenue-facing users require manager consultation. Borderline cases get human review. The system's job is to sort users into the right workflow, not to make removal decisions.

### 3. Delta Analysis -- Inverting the Compound Review Burden

Without run-over-run comparison, every clean-up cycle is a fresh review of the same users. The analyst sees 200 users, reviews all 200, removes 30, and next month sees 190 users -- including 170 they reviewed last time. The review burden compounds because there's no memory.

Delta analysis inverts this. By comparing against the previous run, the system tags each user with context: "you reviewed this user last month and deferred them" or "this user was removed last month but reappeared" or "this user was active last month and is now inactive for the first time." The analyst can process persistently inactive users in seconds (they've seen the reasoning before) and focus their attention on newly inactive users and unexpected reappearances.

The sporadic access register adds another layer: users with project-based access patterns (quarter-end reconciliation, annual audits) are flagged so that their removal and reappearance isn't surprising. The flag doesn't protect them from removal -- it provides context that prevents unnecessary investigation.

Over time, the review surface shrinks. The first run is a full review. By the third run, the analyst is spending most of their time on genuinely new findings.

---

## Impact

| Metric | Before | After |
|---|---|---|
| Analysis time per clean-up | ~2 hours manual | Under 10 minutes |
| End-to-end (identify to ticket) | ~1 business day | Under 2 hours |
| Audit trail | None | Full -- every run, user, and decision recorded |
| Criteria documentation | None -- tacit knowledge | Fully encoded, versioned, editable |
| Cross-run institutional memory | None | Compounds automatically over time |

The time savings are significant, but the larger impact is structural. The process is now documented, auditable, and transferable. Access criteria are explicit and versioned. Clean-up decisions are defensible in escalations because every user has a written reasoning. And the system gets better over time -- delta analysis and sporadic registers mean each run is faster and more informed than the last.

---

## What I'd Do Differently

**Earlier investment in automated testing.** The classification engine has complex branching logic and interacts with multiple data sources. I validated it manually against known clean-up datasets, but a proper test suite with fixtures for each classification path and edge case would have caught regressions faster and made refactoring safer. The demo data exercises all 9 categories, but it's not a substitute for unit and integration tests.

**More modular business rule configuration from day one.** The department classification framework, protected department lists, and activity thresholds are currently encoded in the classification engine. Extracting these into per-instance configuration earlier would have simplified the path from Phase 1 (single platform) to Phase 2 (multiple systems). The self-serve onboarding flow partially addresses this, but the core classifier still has hardcoded assumptions that will need refactoring.

---

## What's Next

**Phase 2 is infrastructure-ready.** The self-serve system onboarding flow -- upload a sample CSV, provide a description, review the AI-generated reasoning table, confirm -- is already built. Expanding to additional SaaS systems requires no engineering work, just an analyst with a CSV and five minutes.

Beyond system expansion: automated ticket submission post-analysis (removing the copy-paste step), automated data loading from platform APIs (removing the manual CSV export step), and ultimately a fully automated end-to-end process operable by a support team member without analyst handover.

---

## A Note on This Repository

This is a sanitized portfolio version of an internal tool built for a SaaS company. Business rules, organizational structures, and company-specific logic have been generalized. Instance names, department structures, and product names are anonymized. The original system is in production use.
