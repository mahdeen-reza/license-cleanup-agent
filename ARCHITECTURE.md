# ARCHITECTURE.md
**License Clean-Up Agent -- Technical Reference**  
Read this when building specific modules. For project overview and critical rules, see `CLAUDE.md`.

---

## 1. Data Sources & Field Schemas

### Usage Platform Export (user activity and license data -- identical across all 5 instances)

| Field | Type | Analysis Role |
|---|---|---|
| `user_email` | String | Primary join key candidate |
| `first_name` | String | Tier 3 name match |
| `last_name` | String | Tier 3 name match |
| `directory_department` | String | Reference only -- HR system overrides |
| `inEmployeeRoster` | String | **DEPRECATED -- never use** |
| `last_activity_date` | String | PRIMARY non-Instance A; UNRELIABLE Instance A (integration skew) |
| `monthly_logins` | Integer | PRIMARY non-Instance A; UNRELIABLE Instance A (integration skew) |
| `is_active` | String | Include in output, do not pre-filter |
| `is_paid_user` | String | Include in output, do not pre-filter |
| `license_type` | String | Context |
| `external_user_id` | String | Reference |
| `city` | String | Reference |
| `state` | String | Reference |
| `platform_department` | String | Platform-side dept -- HR system overrides |
| `user_locale` | String | Reference |
| `user_profile` | String | License profile context |
| `username` | String | Normalization input |
| `user_role_id` | String | Reference |
| `role` | String | Role context |
| `user_type` | String | Standard vs guest vs chatter |
| `lightning_user` | String | Reference |
| `account_created_date` | String | New user exclusion (< 30 days = exclude) |
| `permission_sets` | String | **Feature engagement signal** |
| `permission_set_labels` | String | Human-readable permission labels |
| `feature_licenses` | String | Reference |
| `user_license` | String | License type |
| `permission_set_licenses` | String | Reference |
| `package_licenses` | String | Reference |
| `crm_last_activity_date` | String | **PRIMARY -- core CRM activity date** |
| `platform_last_activity_date` | String | **PRIMARY -- standard object activity date** |
| `crm_days_active_last_90` | Integer | **PRIMARY -- days active on core CRM (90-day window)** |
| `platform_days_active_last_90` | Integer | **PRIMARY -- days active on standard objects (90-day window)** |

### HR System Export (all active and terminated workers)

| Field | Analysis Role |
|---|---|
| `Work Email` | Primary HR join key |
| `Full Name` | Tier 3 name matching |
| `First Name` | Tier 3 name matching |
| `Last Name` | Tier 3 name matching |
| `Active/Inactive Status` | Employment truth -- primary ex-employee signal |
| `Termination Date` | Confirms termination |
| `On Leave` | Leave context |
| `Business Title` | GTM Layer 3 title scan -- authoritative |
| `Division` | **GTM segmentation -- most critical field** |
| `Department` | **GTM Layer 2 elimination** -- authoritative |
| `Manager's Work Email` | Output enrichment for ticket context |
| `Region` | Output enrichment |
| `Product` | Instance product alignment |
| `Worker Type` | FTE vs contractor |
| `Worker Sub-Type` | Additional worker classification |
| `Acquisition Company` | Legacy account ID (acquired employees) |
| `Hire Date` | Tenure context |
| `Employee ID` | Reference |
| `Position` | Reference |
| `Management Level` | Reference |
| `People Manager` | Reference |

---

## 2. Email Normalization Cascade

**Purpose:** Resolve every usage platform user to a canonical `@company.com` email for HR system join.  
**Source fields:** `user_email`, `username`, `first_name`, `last_name`

### Five Failure Modes

| # | Mode | Example | Fix |
|---|---|---|---|
| 1 | Instance suffix in username | `david@company.com.instanceb` | Strip `.instanceb` / `.instancec` / `.instanced` / `.instancee` |
| 2 | Non-company domain | `sarah@subsidiary.com` | Swap domain to `@company.com` |
| 3 | Plus-addressing alias | `user+sfcore@company.com` | Strip `+anything` before `@` |
| 4 | Username != actual name | `david.jones@company.com` (real: David Smith) | Falls through to Tier 3 name match |
| 5 | Non-standard username | `davidj` vs `david.jones` | Falls through to Tier 3 name match |

### Resolution Steps

```typescript
// Step 1 -- Build normalized email candidates
const candidates = [
  email,                                    // A: as-is
  stripPlusAlias(email),                    // B: strip +alias
  stripInstanceSuffix(userName),            // C: strip .instanceb etc -> @company.com
  swapDomain(email),                        // D: swap domain to @company.com
  stripPlusAlias(swapDomain(email)),        // E: D + strip alias
];

// Step 2 -- HR system email match (try all candidates)
for (const candidate of candidates) {
  const match = hrEmailMap.get(candidate.toLowerCase());
  if (match) return { matched: true, record: match, tier: 1 };
}

// Step 3 -- Full name match (use directory name -- NOT derived from email)
// Directory firstName/lastName comes from identity provider -- reliable even when email differs
const nameKey = `${firstName} ${lastName}`.toLowerCase().trim();
const nameMatches = hrNameMap.get(nameKey);
if (nameMatches?.length === 1)
  return { matched: true, record: nameMatches[0], tier: 3, flag: 'name-match-verify' };
if (nameMatches?.length > 1)
  return { matched: false, status: 'AMBIGUOUS' }; // -> Human Review

// Step 4 -- Not found classification
if (isIntegrationUser(email, userName))
  return { matched: false, status: 'INTEGRATION' }; // -> Excluded

// Check HR employment status for unmatched users
const hrStatus = lookupByBroadSearch(email, firstName, lastName);
if (hrStatus?.terminationDate || hrStatus?.status === 'Inactive')
  return { matched: false, status: 'EX_EMPLOYEE' }; // -> Ex-Employee tab

// Check acquisition company -- legacy acquired employee with old email format
if (hrStatus?.acquisitionCompany)
  return { matched: false, status: 'LEGACY_UNRESOLVED' }; // -> Human Review

return { matched: false, status: 'UNRESOLVED' }; // -> Human Review
```

---

## 3. Integration User Patterns

```typescript
const INTEGRATION_PATTERNS = [
  'integration', 'api-user', 'bot', 'system',
  'service', 'data.integrations', 'connector', 'automation'
];
```

**Note:** Integration connector accounts may appear multiple times per instance -- deduplicate before analysis.

---

## 4. Activity Signal Logic

### Instance A (third-party integration skews top-level fields)
```
UNRELIABLE: last_activity_date, monthly_logins
PRIMARY:    crm_last_activity_date            (core CRM activity date)
            platform_last_activity_date       (standard object activity date)
            platform_days_active_last_90      (days active, 90-day window)
SUPPORTING: permission_sets                   (populated = engaged user)
```

### All Other Instances
```
PRIMARY: All 6 activity fields are reliable
  last_activity_date
  monthly_logins
  crm_last_activity_date
  crm_days_active_last_90               (90-day window)
  platform_last_activity_date
  platform_days_active_last_90          (90-day window)
```

### Combined Signal Decision
```
BOTH date fields old + BOTH DaysActive = 0     -> Strong inactivity -> qualifies for removal
ONE field recent + high DaysActive,
  OTHER field old + DaysActive = 0             -> Discrepancy -> HUMAN REVIEW (explain in reasoning)
BOTH fields recent + DaysActive > 0            -> Active -> retain
account_created_date < 30 days ago             -> NEW USER -> exclude entirely
```

---

## 5. Instance Configurations

| Instance | Product Filter | Default Scope |
|---|---|---|
| Instance A | None (all products) | non_GTM |
| Instance B | Product B | non_GTM + product alignment |
| Instance C | Product C | non_GTM + product alignment |
| Instance D | Product D | non_GTM + product alignment |
| Instance E | Product E | non_GTM + product alignment |

---

## 6. Database Schema (Prisma)

```prisma
model AppUser {
  id        String   @id @default(uuid())
  email     String   @unique            // canonical @company.com, stored lowercase
  name      String
  role      String   @default("standard") // "standard" | "admin"
  active    Boolean  @default(true)      // soft delete -- never hard delete
  addedBy   String                       // email of admin who provisioned, or "system"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model System {
  id               String           @id @default(uuid())
  name             String           @unique
  description      String
  foundationalNote String
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  instanceConfigs  InstanceConfig[]
  reasoningTable   ReasoningTable?
  analysisRuns     AnalysisRun[]
}

model InstanceConfig {
  id               String   @id @default(uuid())
  systemId         String
  system           System   @relation(fields: [systemId], references: [id])
  instanceName     String
  defaultScope     String
  thresholds       Json     // { standardDays: 60, urgentDays: 30 }
  productAlignment Json?    // { matchingProducts: ["Product B"] } -- null for Instance A
  gtmHandling      String   // "consult_required"
  createdAt        DateTime @default(now())
}

model ReasoningTable {
  id               String   @id @default(uuid())
  systemId         String   @unique
  system           System   @relation(fields: [systemId], references: [id])
  content          Json
  confirmedByEmail String
  confirmedAt      DateTime
  version          Int      @default(1)
  updatedAt        DateTime @updatedAt
}

model IntegrationPattern {
  id        String   @id @default(uuid())
  pattern   String   @unique
  createdAt DateTime @default(now())
}

model PriorException {
  id            String   @id @default(uuid())
  systemId      String
  userEmail     String
  userName      String
  role          String
  justification String
  action        String   // "keep_flag" | "remove_with_confirmation"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([systemId, userEmail])
}

model AnalysisRun {
  id             String           @id @default(uuid())
  systemId       String
  system         System           @relation(fields: [systemId], references: [id])
  instanceName   String
  cleanupType    String           // "routine" | "on_demand"
  mode           String           // "standard" | "urgent" | "critical"
  licensesNeeded Int?
  ranByEmail     String
  ranAt          DateTime         @default(now())
  totalUsers     Int              @default(0)
  directRemove   Int              @default(0)
  notifyFirst    Int              @default(0)
  exEmployees    Int              @default(0)
  gtmFlagged     Int              @default(0)
  priorException Int              @default(0)
  humanReview    Int              @default(0)
  excluded       Int              @default(0)
  // Async pipeline status tracking
  status        String   @default("completed")  // "processing" | "completed" | "failed"
  statusDetail  String?                          // e.g. "AI reasoning: batch 5 of 34"
  errorMessage  String?                          // populated on failure
  // Review lifecycle (independent of pipeline status)
  reviewStatus  String    @default("in_progress")  // "in_progress" | "submitted"
  ticketNumber  String?                             // e.g. "TICKET-1234"
  submittedAt   DateTime?
  // Delta analysis
  previousRunId        String?
  previousRun          AnalysisRun?  @relation("RunComparison", fields: [previousRunId], references: [id])
  comparedRuns         AnalysisRun[] @relation("RunComparison")
  sporadicFlagged      Int           @default(0)
  reappeared           Int           @default(0)
  newlyInactive        Int           @default(0)
  persistentlyInactive Int           @default(0)
  recovered            Int           @default(0)
  netNew               Int           @default(0)
  results        AnalysisResult[]
  chatOverrides  ChatOverride[]
}

model AnalysisResult {
  id                 String      @id @default(uuid())
  runId              String
  run                AnalysisRun @relation(fields: [runId], references: [id])
  email              String
  fullName           String
  department         String
  division           String
  businessTitle      String
  region             String
  product            String
  managerEmail       String
  onLeave            String
  workerType         String
  acquisitionCompany String?
  sfCreatedDate      String
  lastActivityDate   String?
  monthlyActivity    Int?
  sfLastActivityDate String?
  sfDaysActive       Int?
  platformLastDate   String?
  platformDaysActive Int?
  permissionSets     String?
  profile            String?
  classification     String
  confidenceLevel    String      // "high" | "medium" | "low"
  matchTier          Int         // 1 | 2 | 3
  reasoning          String      // 1-2 sentence plain English explanation
  // Selective actioning
  actionStatus             String    @default("pending")  // "pending" | "actioned" | "deferred"
  actionedAt               DateTime?
  actionedBy               String?
  actionNote               String?
  // Delta analysis
  deltaCategory            String?
  previousClassification   String?
}

model SporadicFlag {
  id               String    @id @default(uuid())
  systemId         String
  instanceName     String                           // "Instance A", "Instance B", etc.
  userEmail        String                           // canonical @company.com email
  userName         String
  flaggedBy        String                           // email of analyst
  flaggedAt        DateTime  @default(now())
  note             String
  active           Boolean   @default(true)
  removalCount     Int       @default(0)
  lastRemovedAt    DateTime?
  lastReappearedAt DateTime?
  updatedAt        DateTime  @updatedAt

  @@unique([userEmail, instanceName])
}

model UserInstanceHistory {
  id             String   @id @default(uuid())
  userEmail      String
  instanceName   String
  eventType      String   // "analysis_run" | "actioned" | "deferred" | "sporadic_flagged" | etc.
  eventDate      DateTime @default(now())
  runId          String?
  classification String?
  note           String?
  actorEmail     String?

  @@index([userEmail, instanceName, eventDate])
}
```

---

## 7. API Routes

```
GET  /api/me                           <- Current user identity + role (from AppUser)
GET  /api/systems                      <- List registered systems + instances
POST /api/systems/onboard              <- New system onboarding (Phase 2)
POST /api/systems/onboard/confirm      <- Confirm reviewed Reasoning Table + save system
POST /api/systems/:systemId/generate-docs <- Generate formal Markdown documentation for a system
POST /api/analysis/run                 <- Start analysis pipeline (returns 202, runs async)
GET  /api/analysis/:runId/status       <- Lightweight polling for pipeline progress
GET  /api/analysis/in-progress         <- In-progress runs for current user (review not yet submitted)
GET  /api/analysis/history             <- Audit log -- completed + submitted runs
GET  /api/analysis/:runId              <- Full details of a past run
GET  /api/analysis/:runId/delta        <- Delta summary for a run (vs previous)
PUT  /api/analysis/:runId/check        <- Toggle single result checkbox (real-time persistence)
POST /api/analysis/:runId/action       <- Batch actioning decisions
POST /api/analysis/:runId/submit       <- Record ticket number and finalize the run
POST /api/analysis/:runId/chat         <- Review conversation (reclassify, add exception, query)
GET  /api/criteria/:systemId           <- Access criteria document for a system
POST /api/criteria/:systemId/chat      <- Criteria update conversation
POST /api/sporadic-flags               <- Add a sporadic/temporary access flag
GET  /api/sporadic-flags/:instanceName <- List sporadic flags for an instance
PUT  /api/sporadic-flags/:id           <- Update or deactivate a sporadic flag
GET  /api/user-history/:email/:instanceName <- User history timeline for a specific user + instance
GET  /api/admin/users                  <- List all provisioned users (admin only)
POST /api/admin/users                  <- Add a user (admin only)
PUT  /api/admin/users/:id             <- Update user name/role/active (admin only)
```

### POST /api/analysis/run -- Request
```typescript
{
  instance: 'Instance A' | 'Instance B' | 'Instance C' | 'Instance D' | 'Instance E';
  cleanupType: 'routine' | 'on_demand';
  mode: 'standard' | 'urgent' | 'critical';
  licensesNeeded?: number;  // required if on_demand
  usageFile: File;          // multipart CSV
  hrFile: File;             // multipart CSV
}
```

### POST /api/analysis/run — Response (202 Accepted)
```typescript
{ runId: string; status: 'processing' }
```
Pipeline runs asynchronously in the background. Frontend polls `GET /api/analysis/:runId/status` for progress updates. On completion, fetches full results via `GET /api/analysis/:runId`.

### GET /api/analysis/:runId/status — Response
```typescript
{
  status: 'processing' | 'completed' | 'failed';
  statusDetail: string | null;    // e.g. "AI reasoning: batch 5 of 34"
  errorMessage: string | null;    // populated on failure
  totalUsers: number;
}
```
Includes stale run detection — runs processing for more than 20 minutes are reported as failed.

---

## 8. Intelligence Layer

### Foundational Knowledge
Stored in DB, loaded as system prompt context. Covers generalizable inactivity principles -- enables reasoning about new systems without starting from scratch.

### AI Reasoning Engine
```typescript
// src/intelligence/reasoningEngine.ts
const prompt = buildAnalysisPrompt({
  foundationalKnowledge,  // from DB
  reasoningTable,         // instance-specific, from DB
  instanceConfig,         // thresholds, product alignment, gtmHandling
  priorExceptions,        // exception register for this instance
  enrichedUsers,          // usage platform + HR joined data
  runConfig,              // mode, cleanupType, licensesNeeded
});

const response = await aiClient.invoke({
  model: process.env.AI_MODEL_ID,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 4096,
});
```

Batch size is configurable via the BATCH_SIZE constant in src/intelligence/reasoningEngine.ts. Each batch = one AI API call.

### Per-User Output from AI
```typescript
{
  email: string;
  classification: string;        // one of 9 categories
  confidenceLevel: 'high' | 'medium' | 'low';
  reasoning: string;             // 1-2 sentence plain English explanation
}
```

### New System Onboarding (Phase 2)
```
Input:  usage CSV + past analysis CSV + 2-5 sentence description
Output: Reasoning Table JSON (human reviews + confirms before first run)
Stored: reasoningTable in DB
```

---

## 9. Additional Database Models (Interactive Layer)

```prisma
model ChatOverride {
  id                   String   @id @default(uuid())
  runId                String
  run                  AnalysisRun @relation(fields: [runId], references: [id])
  userEmail            String
  targetUserEmail      String
  originalClassification String
  newClassification    String
  reason               String
  createdAt            DateTime @default(now())
}

model AccessCriteria {
  id           String            @id @default(uuid())
  instanceId   String            @unique
  instanceName String
  content      Json              // structured criteria document
  version      Int               @default(1)
  updatedAt    DateTime          @updatedAt
  updatedBy    String
  versions     CriteriaVersion[]
}

model CriteriaVersion {
  id          String         @id @default(uuid())
  criteriaId  String
  criteria    AccessCriteria @relation(fields: [criteriaId], references: [id])
  content     Json           // snapshot of criteria at this version
  version     Int
  changedBy   String
  changeNote  String         // what changed and why
  createdAt   DateTime       @default(now())
}

model ChatMessage {
  id          String   @id @default(uuid())
  contextType String   // "analysis_run" | "criteria"
  contextId   String   // runId or criteriaId
  role        String   // "user" | "assistant"
  content     String
  userEmail   String?
  createdAt   DateTime @default(now())
}
```

### POST /api/analysis/run -- Pipeline Steps
```
1. Parse both CSVs (csv-parse)
2. Deduplicate usage platform rows (especially connector duplicates)
3. Exclude new users (createdDate < 30 days)
4. Identify + exclude integration users
5. Run email normalization cascade for all remaining users
6. Enrich matched users with HR data
7. Apply GTM decision framework (multi-layer)
8. Apply instance product alignment (non-Instance A)
9. Check prior exception register
10. Check sporadic flag register -- tag users with known temporary access patterns
11. Send enriched dataset to AI reasoning engine
12. Receive classifications + reasoning per user
13. Save run + results to DB
14. Delta comparison (if previous run exists for this instance):
    a. Look up most recent completed run for this instance
    b. Set previousRunId on current run
    c. Join current results to previous results on email
    d. Tag each result with deltaCategory + previousClassification
    e. Compute and store delta summary counts on AnalysisRun
    f. If no previous run -> baseline run, all deltaCategory = null
15. Write UserInstanceHistory events for all classified users
16. Return structured output (7 tabs + delta summary)
```

### POST /api/analysis/:runId/action -- Selective Actioning
```typescript
// Request body
{
  actions: Array<{
    resultId: string;                    // AnalysisResult ID
    status: 'actioned' | 'deferred';     // analyst decision
    note?: string;                        // optional note
  }>;
}

// Processing:
// 1. Update actionStatus, actionedAt, actionedBy, actionNote on each AnalysisResult
// 2. Write UserInstanceHistory event per user ("actioned" or "deferred")
// 3. For actioned sporadic users: increment removalCount, set lastRemovedAt on SporadicFlag
// 4. Return updated result counts + copyable email list for actioned users
```

### GET /api/user-history/:email/:instanceName -- User History Timeline
```typescript
// Returns chronological event list:
{
  events: Array<{
    eventType: string;
    eventDate: string;
    classification?: string;
    note?: string;
    actorEmail?: string;
    runId?: string;
  }>;
  sporadicFlag?: {
    active: boolean;
    note: string;
    removalCount: number;
    flaggedBy: string;
    flaggedAt: string;
  };
  priorException?: {
    justification: string;
    action: string;
  };
  totalAppearances: number;
  totalTimesActioned: number;
  totalTimesDeferred: number;
}
```

---

## 10. Output Structure

### 7 Output Tabs

| Tab | Contents | Export |
|---|---|---|
| Direct Remove | Inactive non-GTM, full criteria met | Copy plain text email list (ticket ready) |
| Notify First | Inactive, notification required | Copy plain text email list |
| Ex-Employee | Terminated/Inactive in HR system | Copy plain text email list |
| GTM Flagged | GTM inactive + cross-instance anomalies | CSV with full context |
| Prior Exception | Inactive + documented justification | CSV with justification shown |
| Human Review | Borderline, protected departments, ambiguous, discrepant | CSV with agent reasoning |
| Excluded | Integration accounts + new users | CSV for audit |

### Analysis Summary Card (above tabs)
- Total users analyzed, count per classification
- Instance, mode, run timestamp, analyst email
- Data quality warnings (e.g. "11 Tier 3 name-matches -- verify recommended")

### Per-User Fields in Every Tab
`email`, `fullName`, `department`, `division`, `businessTitle`, `region`, `product`,
`managerEmail`, `onLeave`, `workerType`, `acquisitionCompany`, `sfCreatedDate`,
`lastActivityDate`, `monthlyActivity`, `sfLastActivityDate`, `sfDaysActive`,
`platformLastDate`, `platformDaysActive`, `permissionSets`, `profile`,
`classification`, `confidenceLevel`, `matchTier`, `reasoning`

---

## 11. Prior Exception Register

Surfaced in Prior Exception tab if inactive. Never auto-actioned. Populated per-instance as clean-up cycles are conducted.

Example entries (demo data):

| Email | Name | Justification | Action |
|---|---|---|---|
| jane.doe@company.com | Jane Doe | Accesses CRM data for quarterly financial reporting | Keep -- flag |
| bob.smith@company.com | Bob Smith | Accesses CRM records for case study research | Keep -- flag |
| alice.chen@company.com | Alice Chen | Weekend coverage -- access during limited staffing | Remove with manager confirmation |

---

## 12. Ticket Output Format

**Format:** Plain text, one email per line  
**Header:** Must include month of clean-up  
**Lead time:** At least one week in advance  
**Agent output:** One-click copy-to-clipboard per action tab

---

## 13. Delta Analysis -- Run-Over-Run Comparison

### Comparison Logic (src/core/deltaComparison.ts)

```typescript
interface DeltaResult {
  resultId: string;
  email: string;
  deltaCategory: 'newly_inactive' | 'persistently_inactive' | 'recovered' | 'reappeared' | 'net_new' | null;
  previousClassification: string | null;
}

function computeDelta(
  currentResults: AnalysisResult[],
  previousResults: AnalysisResult[],
  sporadicFlags: SporadicFlag[]
): DeltaResult[] {
  const previousByEmail = new Map(previousResults.map(r => [r.email, r]));
  const sporadicByEmail = new Map(sporadicFlags.map(f => [f.userEmail, f]));

  return currentResults.map(current => {
    const previous = previousByEmail.get(current.email);

    if (!previous) {
      return { ...current, deltaCategory: 'net_new', previousClassification: null };
    }

    const wasActioned = previous.actionStatus === 'actioned';
    const wasActionable = ['direct_remove', 'notify_first', 'ex_employee', 'gtm_consult_required',
                           'cross_instance_anomaly', 'prior_exception', 'human_review'].includes(previous.classification);
    const isActionable = ['direct_remove', 'notify_first', 'ex_employee', 'gtm_consult_required',
                          'cross_instance_anomaly', 'prior_exception', 'human_review'].includes(current.classification);
    const isExcluded = ['excluded'].includes(current.classification);

    // Reappeared: was actioned for removal in previous run, now back
    if (wasActioned && !isExcluded) {
      return { ...current, deltaCategory: 'reappeared', previousClassification: previous.classification };
    }

    // Recovered: was flagged last time, now active/excluded
    if (wasActionable && !isActionable) {
      return { ...current, deltaCategory: 'recovered', previousClassification: previous.classification };
    }

    // Persistently inactive: flagged before, flagged again
    if (wasActionable && isActionable) {
      return { ...current, deltaCategory: 'persistently_inactive', previousClassification: previous.classification };
    }

    // Newly inactive: was not flagged before, now flagged
    if (!wasActionable && isActionable) {
      return { ...current, deltaCategory: 'newly_inactive', previousClassification: previous.classification };
    }

    return { ...current, deltaCategory: null, previousClassification: previous.classification };
  });
}
```

### Edge Cases

- **First run for instance:** No comparison. All deltaCategory = null. Delta Summary Bar shows "Baseline run."
- **Mode mismatch:** If previous run was Standard (60-day) and current is Urgent (30-day), show warning: "Previous run used Standard mode. Some newly inactive users may appear due to lower threshold."
- **Long gap between runs:** Note elapsed time: "Last run was 94 days ago."
- **Department change between runs:** Handled naturally -- current classification uses current HR data. Delta badge can note: "Previously non-GTM, now GTM."

---

## 14. Sporadic/Temporary Access Register

### Concept

Separate from Prior Exception Register. Prior exceptions = "don't remove, standing business need." Sporadic flags = "remove when inactive, but this user has a pattern of temporary/project-based access." The flag does NOT predict return. It records the observed pattern.

### Per-Instance Scoping

A user can be sporadic on Instance A but permanent on Instance B. The flag exists at the `[userEmail, instanceName]` level. Same user, different instance = independent flags.

### How Flags Are Created

1. **Via Review Chat:** Analyst says "Flag user as temporary access -- quarter-end reconciliation" -> tool stores flag
2. **Via User History Panel:** Analyst opens user's history, clicks "Flag as Temporary/Project-Based Access" button, adds note

### How Flags Are Applied in Analysis (Pipeline Step 10)

- Load all active SporadicFlag records for the current instance
- Match against enriched user list by email
- Tag matched users with sporadic context (badge data, removal count, last removed date)
- Sporadic users are NOT reclassified -- they still land in their normal tab (Direct Remove, etc.)
- Their row includes the sporadic badge and history for analyst context

### How Flags Update After Actioning

- When analyst actions a sporadic user for removal: increment `removalCount`, set `lastRemovedAt`
- When a sporadic user reappears in a future run: set `lastReappearedAt`, delta category = "reappeared"

---

## 15. User History View

### Data Sources (assembled per query, no denormalization)

1. `AnalysisResult` -- every run appearance (classification, reasoning, actionStatus, deltaCategory)
2. `UserInstanceHistory` -- event log (actioned, deferred, sporadic flagged, chat overrides)
3. `SporadicFlag` -- current sporadic status
4. `PriorException` -- current exception status
5. `ChatOverride` -- any reclassifications with reasons

### Query Pattern

```sql
-- Primary: all events for user + instance, newest first
SELECT * FROM UserInstanceHistory
WHERE userEmail = ? AND instanceName = ?
ORDER BY eventDate DESC;

-- Supplementary: all analysis appearances
SELECT ar.*, r.ranAt, r.mode, r.cleanupType
FROM AnalysisResult ar JOIN AnalysisRun r ON ar.runId = r.id
WHERE ar.email = ? AND r.instanceName = ?
ORDER BY r.ranAt DESC;

-- Current flags
SELECT * FROM SporadicFlag WHERE userEmail = ? AND instanceName = ?;
SELECT * FROM PriorException WHERE userEmail = ?;
```

### Timeline Display

Chronological list showing:
- Each analysis run appearance with classification and reasoning at that time
- Each action taken (actioned/deferred) with timestamp and actor
- Sporadic flag events (flagged/unflagged) with notes
- Chat override events with before/after classification and reason
- Summary stats: total appearances, times actioned, times deferred, removal count
