# PRD.md
## SaaS License Clean-Up Agent
**Last Updated:** April 2026  
**Status:** In Development -- Phase 1  

---

## Summary

An internal web application that automates the analysis phase of SaaS license clean-ups. When instances run low on seats, a structured clean-up process is required to identify and remove inactive or low-active users -- freeing capacity for new hires and active users. Today this process takes approximately 2 hours of focused work and a full business day end-to-end. This tool compresses that to minutes by automating data joining, enrichment, and classification while keeping the human firmly in control of all final decisions.

---

## Problem Statement

Organizations running multiple SaaS instances face recurring license capacity constraints. When license capacity runs low, new user onboarding is blocked until a clean-up frees seats. The clean-up process today is entirely manual:

1. Export usage platform data and HR system employee data
2. Load both into spreadsheets
3. Manually map emails, join datasets, apply business rules
4. Identify inactive/low-active users
5. Compile removal list and submit support ticket

This takes ~2 focused hours and ~1 full business day end-to-end due to competing priorities. The process is error-prone, undocumented, and relies entirely on tacit knowledge. Access criteria are not formally defined. There is no audit trail. Every clean-up starts from scratch.

---

## Goals

| Goal | Detail |
|---|---|
| Reduce analysis time | From ~2 hours manual to <10 minutes agent-assisted |
| Eliminate manual data prep | No more spreadsheet joins or formula mapping |
| Enforce consistent criteria | GTM framework, inactivity thresholds, and classification rules applied uniformly every run |
| Create audit trail | Every run, every classification, every action decision recorded in DB |
| Build institutional memory | Delta analysis, sporadic registers, and user history compound knowledge across runs -- review burden shrinks over time |
| Protect data | Full HR employee data handled securely -- never exposed beyond authorized users |
| Scale to new systems | Self-serve onboarding flow enables Phase 2 expansion without engineering work |

## Non-Goals

- Automating user removal or notifications (human executes all actions). Ticket content is generated and the ticketing portal is opened, but the analyst submits the ticket manually.
- Scheduling or triggering clean-ups automatically
- Pulling data directly from usage platform or HR system APIs
- Exposing APIs for other internal services to consume
- Supporting systems other than the initial platform in Phase 1

---

## Primary Users

| User | Role | Usage Pattern |
|---|---|---|
| Systems Governance Analyst | Primary analyst | Runs all clean-ups, configures instances |
| Support Team Lead | Reviewer | Reviews output, submits support tickets |
| Senior Manager, System Operations | Oversight | Reviews GTM flagged users and anomalies |

---

## Core User Flows

**In-Progress Runs:** When an analyst opens the app, any runs that are completed but not yet submitted (review still in progress) are shown below the run configuration form. Each in-progress run shows instance, mode, date, and a progress bar indicating how many users have been reviewed. Analyst can click **Resume** to continue reviewing where they left off.

### Flow 1 -- Routine Monthly Clean-Up (Standard Mode)

1. Analyst exports usage platform CSV for target instance and HR system report
2. Opens app -> selects instance from dropdown (Instance A / B / C / D / E)
3. Selects clean-up type: **Routine** | mode: **Standard**
4. Uploads both CSV files
5. Clicks **Run Analysis**
6. Pipeline starts asynchronously -- app returns immediately with a progress indicator. Analyst sees real-time status updates (e.g. "AI reasoning: batch 5 of 34"). Agent processes: normalizes emails -> joins HR data -> applies GTM framework -> classifies all users -> generates reasoning per user -> compares against previous run for this instance (if exists)
7. **Delta Summary Bar** appears (if not baseline run): shows counts of newly inactive, persistently inactive, recovered, reappeared, and net new users. Analyst uses this to prioritize review -- newly inactive first, then persistently inactive for quick confirmation.
8. Results appear across 7 tabs: Direct Remove / Notify First / Ex-Employee / GTM Flagged / Prior Exception / Human Review / Excluded. Each row shows full employee details (name, department, division, title, product, region, manager, worker type, on leave) alongside activity fields and agent-generated classification, confidence, match tier, reasoning, and delta badge.
9. Analyst reviews each tab -- reads per-user reasoning. **Checks the checkbox** on each user they accept for action. Unchecked users are logged as "deferred."
10. Clicks **User History** on any row to open the side panel -- sees this user's full history on this instance (past classifications, actions taken, sporadic flags, chat overrides). Uses this to make informed decisions on borderline cases.
11. Uses Review Chat to reclassify users, add exceptions, flag users as temporary/project-based access, or query results as needed (see Flow 4)
12. Clicks **Submit Ticket** -> submission modal opens with pre-filled fields (summary, justification with email list, system, priority). Analyst reviews, clicks **Open Portal** to open the ticketing portal with content copied to clipboard, and submits.
13. After submitting, enters the ticket number (e.g. TICKET-1234) back in the modal -> tool records ticket number, marks run as "submitted," and logs all actioned/deferred users in the audit trail.
14. Repeats for Notify First tab -- sends notifications to checked users (using standard template)
15. Escalates GTM Flagged and Prior Exception users with managers as needed

### Flow 2 -- On-Demand Clean-Up (Urgent/Critical Mode)

1. Support flags license shortage -- specifies minimum seats needed and deadline
2. Analyst opens app -> selects instance -> selects **On-Demand**, enters minimum licenses needed, selects **Urgent** or **Critical** mode
3. Uploads both CSVs -> runs analysis (pipeline runs asynchronously with progress tracking)
4. Agent prioritizes output: lowest-risk removals ranked first to hit minimum target quickly. Delta Summary shows context from previous runs if available.
5. Analyst works through Direct Remove list top-down, **checking off users** until minimum is met. Checkboxes persist in real-time. Uses User History panel to quickly verify borderline cases.
6. Uses Review Chat to adjust any classifications before finalizing (see Flow 4)
7. Clicks **Submit Ticket** -> submission modal opens with pre-filled content, analyst submits via ticketing portal and records ticket number
8. Tool finalizes run as "submitted" with ticket number for audit trail
9. Continues with remaining list at own discretion

### Flow 3 -- User History Investigation (During Review)

While reviewing analysis output, the analyst encounters a user they're unsure about.

1. Analyst clicks on the user's row in the output tab
2. **User History Panel** slides open showing the user's complete history on this instance:
   - Every past analysis run appearance (classification, reasoning, confidence at that time)
   - Every action taken (actioned for removal, deferred, overridden via chat)
   - Sporadic/temporary access flag status and history
   - Prior exception status
   - Removal and re-provisioning timeline
   - Chat override history with reasons
3. Analyst sees, for example: "Removed in January 2026, re-provisioned in February 2026, flagged as temporary access -- quarter-end reconciliation"
4. Based on history, analyst makes an informed decision -- checks the box to action, or leaves unchecked to defer
5. Optionally adds a note or flags the user as temporary/project-based access directly from the panel

**First run:** Panel shows "First appearance in analysis for Instance A." History builds over time.

### Flow 4 -- Review Conversation (Post-Analysis Interactive Chat)

After analysis results are displayed, a chat panel is available alongside the results. Supports 6 interaction types:

**Reclassify a user:**
> *"Move user@company.com from Direct Remove to Prior Exception -- confirmed need for access for Q2 reconciliation"*
> Agent moves user, records override with reason, updates tab counts, logs to audit trail.

**Add a new exception with reason:**
> *"Add user@company.com to the exception register for Instance A -- uses the system for case study research"*
> Agent adds to Prior Exception register in DB, explains what changed, surfaces in future runs automatically.

**Flag a user as temporary/project-based access:**
> *"Flag user@company.com as temporary access on Instance A -- only uses the system during quarter-end close for reconciliation"*
> Agent adds to Sporadic Register for this instance, explains what changed. In future runs, this user carries a "Known temporary/project-based access" badge with removal/re-provisioning history. The flag does NOT protect them from removal -- it provides context.

**Ask why a user was classified a certain way:**
> *"Why was user@company.com classified as Human Review instead of Direct Remove?"*
> Agent explains its reasoning -- which signals it weighted, what thresholds it applied, what caused uncertainty.

**Filter and query results:**
> *"Show me all Finance users with less than 5 days active in the last 90 days"*
> *"How many non-GTM users have been inactive for more than 60 days?"*
> Agent queries the current run results and returns a structured answer.

**Query delta / history context:**
> *"Show me all users who were deferred in the last run"*
> *"Which users have been removed and re-provisioned more than once?"*
> Agent queries historical data and returns structured answers.

**Key design principle:** Every interaction is logged -- who changed it, when, original state, new state, reason given. All chat-driven knowledge (sporadic flags, team-level rules, reclassification reasons) is stored persistently and applied automatically in future runs. The chat builds institutional memory that compounds over time.

### Flow 5 -- Access Criteria Review and Update

1. User navigates to **Knowledge Base** in the app
2. Selects instance (e.g. Instance A) -> views current access criteria document
3. Document shows: active criteria, exception register, historical removal patterns, threshold settings, version history
4. Opens chat to propose a change:
   > *"Finance users should only keep access if they're in AP or Revenue Accounting teams"*
5. Agent drafts the criteria update, explains what changes, flags any users in recent runs affected by this rule
6. User confirms -> criteria document updated, new version saved, change logged with timestamp and author
7. Updated criteria applied to all future analysis runs for this instance automatically

**Version history:** Every criteria change is versioned. User can view full change history, see who made each change, and revert to a previous version if needed.

### Flow 6 -- New System Onboarding (Phase 2)

1. Analyst clicks **Add New System**
2. Uploads sample usage report CSV from new system
3. Uploads past manual analysis CSV (example decisions) if available
4. Types 2-5 sentences: tool purpose, primary user base, rough access rules
5. Agent generates a Reasoning Table -- structured JSON showing field interpretations, inactivity signals, thresholds, and scope rules
6. Analyst reviews table inline -- edits any field if needed
7. Clicks **Confirm** -> system goes live immediately
8. All future runs for this system use the confirmed Reasoning Table

---

## Data & Integrations

### Inputs (manual upload, Phase 1)
| File | Source | Format |
|---|---|---|
| Usage Platform Export | License management platform, filtered by application and license | CSV |
| HR System Export | HR system -- all active and terminated workers report | CSV |

### Processing
- Email normalization cascade (5 failure modes -- see `ARCHITECTURE.md`)
- HR system join (authoritative for all employee data)
- GTM classification (multi-layer framework using Division, Department, Business Title, Product)
- AI reasoning (classification + per-user explanation)

### Storage
- PostgreSQL (Docker Compose service, named volume)
- All run history and results persisted for audit trail
- Per-user action decisions (actioned/deferred) logged per run
- Sporadic/temporary access flags persisted per user per instance
- User-level event history for timeline view
- No raw CSV data stored -- processed results only

### No external API integrations in Phase 1
Usage platform and HR system data is uploaded manually. Ticket submission is manual. Notifications are manual.

---

## Success Metrics

| Metric | Baseline (Today) | Target |
|---|---|---|
| Analysis time per clean-up | ~2 hours focused work | <10 minutes |
| End-to-end time (identify -> ticket) | ~1 full business day | <2 hours |
| Classification accuracy vs manual | N/A (no baseline) | >95% agreement on non-borderline cases after validation testing |
| Audit trail | None | 100% of runs recorded with full per-user reasoning |
| Review time reduction over runs | N/A | Persistently inactive users reviewed 3x faster by run 3 due to delta context |
| Sporadic user re-investigation time | Same as new user each time | Near-zero -- history panel provides instant context |

---

## Security & Data Privacy

- **Authentication + app-level authorization** -- all routes protected. Only explicitly provisioned users can access the app. Two roles: `admin` (user management) and `standard` (full app usage). At least one admin must always exist.
- **HR data sensitivity** -- full employee list including names, titles, managers, employment status. Treated as confidential. Not stored raw -- processed results only persisted.
- **Secrets management** -- all API keys and DB credentials via environment variables. Never committed to repo.
- **Audit trail** -- every run records who ran it, when, what instance, what mode, and full per-user classifications.
- **No public APIs** -- app cannot be called by other services. User-facing browser app only.

---

## Constraints

| Constraint | Detail |
|---|---|
| Auth | Authenticated access only -- no external access |
| AI | Anthropic Claude API |
| File upload | Manual in Phase 1 -- no API integrations |
| Actions | Human-executed only -- no automated removals or notifications. Ticket content is generated but submitted manually via ticketing portal. |

---

## Open Questions & Risks

| # | Item | Risk Level | Mitigation |
|---|---|---|---|
| 1 | **Classification accuracy** -- agent may misclassify borderline users | High | Thorough testing against known past clean-ups before production use. Validate output of first 3 runs manually. All borderline cases go to Human Review tab by design. |
| 2 | **HR data sensitivity** -- full employee roster uploaded to app | High | Auth protection on all routes. No raw data stored. Processed results only. Secrets via env vars. Access limited to authorized users. |
| 3 | **Inactivity thresholds not formally defined** | Medium | Current baselines (60-day Standard, 30-day Urgent) derived from practice. Agent data over time will inform refinement. Documented as configurable in instance configs. |
| 4 | **GTM title list completeness** -- new roles may not match known GTM titles | Medium | Unknown Customer-division titles default to Human Review (conservative). List updated iteratively as new roles surface. |
| 5 | **Legacy acquired accounts** -- acquired employees with old email formats | Medium | Handled via Acquisition Company field in HR system + Tier 3 name matching. Unresolved -> Human Review, not auto-removal. |
| 6 | **Prior exception register completeness** -- undocumented exceptions | Low | Exceptions added iteratively after first clean-up cycles. |

---

## V1 Scope (Phase 1)

**In scope:**
- All 5 instances
- Routine and on-demand clean-up modes (Standard / Urgent / Critical)
- Full email normalization cascade
- HR enrichment and GTM classification
- 9-category classification with per-user reasoning
- 7-tab output with full employee details per row
- **Selective Actioning -- per-user checkboxes, analyst curates the action list, every accept/defer logged**
- **Delta Analysis -- run-over-run comparison with 5 delta categories (newly inactive, persistently inactive, recovered, reappeared, net new)**
- **Sporadic/Temporary Access Register -- per-instance flags for users with project-based access patterns, removal/re-provisioning tracking**
- **User History View -- per-user timeline panel showing all past appearances, actions, flags, and overrides for a specific instance**
- **Review Conversation -- post-analysis interactive chat (reclassify, add exceptions, flag sporadic users, query results and history)**
- **Living Access Criteria -- per-instance criteria document with versioning and AI-assisted updates**
- **Ticket Submission Workflow -- pre-filled modal, opens ticketing portal, records ticket number for audit trail**
- **In-Progress Runs -- resume incomplete reviews, real-time progress tracking across sessions**
- **Async Analysis Pipeline -- background processing with real-time status polling, eliminates timeout issues on large datasets**
- New system onboarding flow (built in Phase 1, used in Phase 2)
- Analysis run history and audit log

**Out of scope (Phase 1):**
- Additional systems (Phase 2)
- Fully automated ticket submission (tool generates content and opens portal, but analyst submits manually)
- Automated notifications
- Scheduled/recurring analysis triggers
- Usage platform or HR system API integrations
- Mobile browser support

---

## Phase 2 Scope

Same app, same workflow, same deployment. No new infrastructure. Expand to additional systems using the self-serve onboarding flow built in Phase 1.
