# CLAUDE.md
**Project:** SaaS License Clean-Up Agent  
**Stack:** TypeScript + Express + Prisma + React/Vite + PostgreSQL + Anthropic Claude API  

---

## What This Is

A web app that automates the analysis phase of SaaS license clean-ups. Analyst uploads two CSVs (usage platform export + HR system export), selects instance and mode, and the agent classifies every user into one of 9 categories with plain-English reasoning. Analyst reviews output before taking any action.

**Phase 1:** Salesforce only (5 instances). Manual file upload. Analysis + output only.  
**Phase 2:** Add more systems via self-serve onboarding flow built in Phase 1.  
**Never:** Auto-remove users, auto-submit tickets, auto-notify. All actions require human review.

---

## Repo Structure

```
license-cleanup-agent/
├── CLAUDE.md                    <- This file
├── ARCHITECTURE.md              <- Full technical depth -- read when building specific modules
├── PRD.md                       <- Product requirements
├── docs/RULES_DECISION_TABLE.md <- Analysis logic, GTM framework, classification rules
├── Dockerfile                   <- Multi-stage build
├── docker-compose.yaml          <- Production deployment
├── docker-compose.dev.yaml      <- Local dev overlay
├── .env.example
├── prisma/schema.prisma         <- Extended with project models
├── src/
│   ├── server.ts
│   ├── lib/prisma.ts + ai.ts
│   ├── middleware/auth.ts        <- Email/password auth + AppUser authorization
│   │              requireAdmin.ts <- Admin-only route guard
│   ├── routes/                  <- me, systems, onboarding, analysis, chat, criteria,
│   │                               actioning, sporadicFlags, userHistory, admin
│   ├── core/                    <- emailNormalizer, hrEnricher, classifier,
│   │                               outputFormatter, deltaComparison, actionTracker
│   └── intelligence/            <- foundationalKnowledge, systemOnboarder, reasoningEngine,
│                                   reviewChat, criteriaManager
└── frontend/src/components/     <- WelcomeBanner, FileUploader, InstanceSelector,
                                    RunConfig, AnalysisResults, ExportButton,
                                    ReviewChat, KnowledgeBase, CriteriaViewer,
                                    DeltaSummaryBar, UserHistoryPanel, ActionConfirm,
                                    AdminConsole, AccessDenied
```

---

## Platform Constraints

1. **Docker Compose mandatory** -- `docker-compose.yaml` at repo root.
2. **No host port bindings in production** -- use `ports: ["8000"]` only. Dev overlay adds fixed ports.
3. **Named volumes only** -- no bind mounts for persistent data in production.
4. **`restart: always`** on every service.
5. **Prisma migrations only** -- all schema changes via committed migration files. Never patch DB manually.
6. **Single container** -- React/Vite builds to `dist/`, Express serves it statically. No separate frontend container.

**Local dev:** `docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up`

---

## Auth Pattern

Two layers: **authentication** (email/password login with signed tokens) and **app-level authorization** (handled by `AppUser` table).

```typescript
// src/middleware/auth.ts
// 1. Extract user email from Bearer token or DEV_USER_EMAIL fallback
// 2. Look up email in AppUser table
//    - Not found / inactive -> 403
//    - Found + active -> req.appUser = { id, email, name, role, active }
//                       req.userEmail = email (backward compat)
// 3. In dev mode, missing AppUser is auto-created as admin
```

**Roles:** `admin` (full app + user management) and `standard` (full app usage).
**Admin routes** (`/api/admin/*`) are additionally gated by `requireAdmin` middleware.
Every analysis run records `ranByEmail` for audit trail.

---

## The Two Input Files

**File 1 -- Usage Platform Export** (user activity and license data, identical schema across all 5 instances)  
**File 2 -- HR System Export** (employee data -- all active and terminated workers)

**The HR system is the authoritative source for ALL employee data.** Always overrides directory/usage platform fields.  
**`inEmployeeRoster` field in the usage platform export is DEPRECATED -- never use it.** The usage platform's roster check can't handle the normalization complexity we apply. Use HR system `Active/Inactive Status` + `Termination Date` instead.

Full field mappings -> see `ARCHITECTURE.md`

---

## Critical Rules -- Read Before Writing Any Code

### Instance A Activity Fields Are Unreliable
- `last_activity_date` and `monthly_logins` are **skewed by third-party integration** in Instance A only -- integration logins count as application activity.
- For Instance A: use `crm_last_activity_date`, `platform_last_activity_date`, `platform_days_active_last_90` as primary signals.
- For all other instances: all 6 activity fields are reliable.

### Protected Departments
- Certain departments are configured as "protected" -- non-GTM for analysis purposes but **never directly actioned**.
- Always -> Human Review tab with note: "Protected department -- verify access requirement before actioning."

### New Users Are Excluded
- `account_created_date` within last 30 days -> exclude from analysis entirely.

### permissionSets Is a Signal
- Populated array (e.g. `["skuid","CHRGFYNG"]`) = meaningful engagement even if date fields look borderline.
- Empty `[]` + old dates = stronger inactivity signal.

---

## GTM Decision Framework (Simplified)

```
Layer 1 -- Division:
  Sales -> GTM (all departments)
  CEO / Marketing / Operations / Product / Technology -> Non-GTM
  Customers -> Layer 2

Layer 2 -- Department (Customers division):
  Support -> Non-GTM
  Protected departments (configurable) -> Human Review always
  Engagement / Field Support / Launch Services / Professional Services -> Layer 3

Layer 3 -- Business Title scan:
  GTM titles: Account Manager/Executive, Client/Customer Success, Implementation,
  Launch, Onboarding, Trainer, Solutions Consultant, Technical Consultant,
  Strategic/Field Implementation, Engagement, Revenue, GTM, Partner
  Non-GTM titles: Support Specialist/Associate/Manager/Representative

Layer 4 -- Instance product alignment (non-Instance A only):
  GTM + matching product -> Expected. Standard GTM protection.
  GTM + non-matching product -> FLAG: cross-instance anomaly -> Human Review
  Non-GTM + non-matching product -> Priority removal candidate
```

**Instance product mappings:**
Instance B = "Product B" | Instance C = "Product C" | Instance D = "Product D"  
Instance E = "Product E"  
Instance A = no product filter

---

## 9 User Classifications

| Classification | Tab | Action |
|---|---|---|
| Direct Remove | Direct Remove | Submit support ticket |
| Notify First | Notify First | Notification -> 5-7 day window |
| Ex-Employee | Ex-Employee | Priority ticket -- offboarding failure |
| GTM -- Consult Required | GTM Flagged | Consult manager |
| Cross-Instance Anomaly | GTM Flagged | Verify business need |
| Prior Exception | Prior Exception | Show justification, human decides |
| Human Review | Human Review | Human verifies |
| Excluded | Excluded | Never action |
| Unresolved | Human Review | Manual investigation |

Full classification logic -> see `docs/RULES_DECISION_TABLE.md`

---

## Clean-Up Modes & Run Inputs

| Mode | Threshold | Scope |
|---|---|---|
| Standard | 60+ days | Non-GTM first, GTM if needed |
| Urgent | 30+ days | All departments |
| Critical | None | All users |

Required inputs per run: `instance`, `cleanupType` (routine/on-demand), `mode`, `licensesNeeded?`  
GTM always requires consultation regardless of mode.

---

## Selective Actioning -- Checkbox Model

The analyst does NOT bulk-action entire tabs. Every row in every action tab has a checkbox. The analyst reviews each user -- reading the reasoning, employee details, and activity signals -- then checks off the ones they accept for action. Only checked users appear in the final action list.

**Per-row output includes full employee context:** name, email, department, division, business title, product, region, manager email, worker type, on leave status -- alongside all activity fields and agent-generated classification, confidence, match tier, and reasoning.

**After checking users and clicking "Confirm Selected":**
1. Generates copyable email list from checked users only
2. Logs each checked user as "actioned" in the database (timestamp + analyst email)
3. Unchecked users logged as "deferred" -- distinct from "not yet reviewed" (which stays "pending")

**Action statuses:** `pending` (not yet reviewed) -> `actioned` (confirmed for action) -> `deferred` (reviewed but intentionally skipped)

Every action record feeds into the Delta Analysis and User History features.

---

## Delta Analysis -- Run-Over-Run Comparison

Every analysis run after the first for a given instance automatically compares against the most recent previous run. Comparison is at the email level, always instance-scoped.

### Five Delta Categories

| Category | Meaning | Analyst Action |
|---|---|---|
| Newly Inactive | Active or absent last run, now meets inactivity threshold | Primary review focus -- fresh eyes needed |
| Persistently Inactive | Flagged in previous run AND flagged again now | Faster review -- analyst has seen them before |
| Recovered | Flagged in previous run, now showing activity | No action needed -- self-corrected |
| Reappeared | Actioned (submitted for removal) in prior run, now back in usage export | Investigate -- re-provisioning, possibly sporadic user |
| Net New | Email appears for the first time in any run for this instance | Context -- not the same as "new user" by createdDate |

### Pipeline Integration

After the existing 13-step pipeline completes, a new step 14:
1. Look up previous completed run for this instance via `previousRunId`
2. If none exists -> baseline run, skip delta, all users tagged null
3. If exists -> join current results to previous results on email
4. Tag each result with delta category + store previous classification
5. Compute and store delta summary counts on `AnalysisRun`

### UI: Delta Summary Bar

Sits between the Analysis Summary Card and the tabs. Shows counts per delta category. Clickable -- filters the view to show only that category across all tabs. Includes mode mismatch warning if previous run used a different threshold.

### UI: Per-User Delta Badge

Each row in every tab shows a small badge with delta status: "Persistently Inactive (2nd month)" or "Newly Inactive" or "Reappeared -- removed March 2026."

---

## Sporadic/Temporary Access Register

Separate from the Prior Exception Register. Prior exceptions say "don't remove -- standing business need." Sporadic flags say "remove when inactive, but this user has a pattern of temporary/project-based access." The flag does NOT predict return -- it records the pattern.

**Per-instance scoping:** A user can be sporadic on Instance A but permanent on Instance B. Flag lives at the intersection of user + instance.

**How flags are created:** Through the Review Chat or through the User History panel. Analyst says "Flag user as temporary access -- uses the system for quarter-end reconciliation" and the tool stores it.

**How flags are used in analysis:**
- Sporadic users who are inactive still appear in the appropriate action tab (Direct Remove or Notify First)
- They carry a badge: "Known temporary/project-based access -- flagged March 2026"
- Removal and re-provisioning history shown: "Removed 2 times, re-appeared 2 times on this instance"
- When a sporadic user reappears after removal, delta category shows "Reappeared" with softer context vs. an unexpected reappearance

**Stored fields:** email, instance, who flagged, when, note, active status, removal count, last removed, last reappeared.

---

## User History View -- Per-User Timeline

Clicking any user row in the output opens a side panel showing their complete history on this instance:

- Every analysis run appearance (classification, confidence, reasoning at that time)
- Every action taken (actioned, deferred, overridden via chat)
- Sporadic flag status and history
- Prior exception status
- Removal and re-provisioning timeline
- Chat override history with reasons

**Data source:** `UserInstanceHistory` event log + joins to `AnalysisResult`, `SporadicFlag`, `PriorException`, `ChatOverride`

**First run:** Shows "First appearance in analysis for Instance A" -- history builds over time.

Analyst can add sporadic flags and notes directly from this panel rather than going through the chat.

---

## Key Design Decisions

- **HR-system-primary** -- more reliable than directory/usage platform for all employee data
- **Conservative by design** -- borderline cases -> Human Review. Wrong removal cost > missed removal cost.
- **Reasoning field on every user** -- plain English explanation, stored in DB, defensible in escalations
- **Ex-employees are a separate finding** -- offboarding failure, different priority, different support ticket
- **Tier 3 name matches always flagged** -- ambiguous, never auto-actioned
- **No pre-filtering on `is_active`/`is_paid_user`** -- activity fields tell the full story
- **Selective actioning** -- analyst curates the action list per-user, never bulk. Every accept/defer is logged.
- **Delta analysis compounds institutional memory** -- each run builds on the last. Review surface shrinks over time as the tool tracks persistent patterns.
- **Sporadic != Exception** -- sporadic users get removed when inactive (correct action) but the tool remembers the pattern for context. Exceptions are protected from removal entirely.
- **User history is read-only aggregation** -- no new write complexity, just a timeline assembled from existing data

---

## References

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | Full field schemas, normalization cascade, DB schema, API routes, intelligence layer |
| `docs/RULES_DECISION_TABLE.md` | Complete analysis logic, GTM framework, exception register, output format |
| `PRD.md` | Product requirements, user flows, success metrics |
