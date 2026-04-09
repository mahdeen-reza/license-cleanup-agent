# Rules Decision Table
## SaaS License Clean-Up Agent
**Last Updated:** March 2026  
**Status:** Active -- foundational document for agent analysis logic

---

## 1. Instances in Scope

| Short Name | Product Filter | User Base |
|---|---|---|
| Instance A | All products (no filter) | Entire company -- primary instance |
| Instance B | Product B | Product B vertical teams |
| Instance C | Product C | Product C vertical teams |
| Instance D | Product D | Product D vertical teams |
| Instance E | Product E | Product E vertical teams |

---

## 2. Data Sources

### 2.1 Usage Platform Export (user activity and license data -- identical schema across all 5 instances)

| Field | Type | Use in Analysis |
|---|---|---|
| `user_email` | String | Primary join key attempt |
| `first_name` | String | Tier 3 name match |
| `last_name` | String | Tier 3 name match |
| `directory_department` | String | Reference only -- HR system overrides |
| `inEmployeeRoster` | String (Yes/No) | **DEPRECATED -- do not use for employment logic** |
| `last_activity_date` | String | Primary signal for non-Instance A; unreliable for Instance A (integration skew) |
| `monthly_logins` | Integer | Primary signal for non-Instance A; unreliable for Instance A (integration skew) |
| `is_active` | String | Include in output but do not pre-filter |
| `is_paid_user` | String | Include in output but do not pre-filter |
| `license_type` | String | Context field |
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
| `account_created_date` | String | New user exclusion check |
| `permission_sets` | String | Feature engagement signal |
| `permission_set_labels` | String | Human-readable permission set labels |
| `feature_licenses` | String | Feature license context |
| `user_license` | String | License type |
| `permission_set_licenses` | String | Reference |
| `package_licenses` | String | Reference |
| `crm_last_activity_date` | String | **PRIMARY signal -- core CRM object activity (date)** |
| `platform_last_activity_date` | String | **PRIMARY signal -- standard object activity (date)** |
| `crm_days_active_last_90` | Integer | **PRIMARY signal -- days active on core CRM objects (90-day window)** |
| `platform_days_active_last_90` | Integer | **PRIMARY signal -- days active on standard objects (90-day window)** |

### 2.2 HR System Export -- All Active and Terminated Workers

**Authoritative source for all employee data. Always overrides directory/usage platform fields.**

| Field | Use in Analysis |
|---|---|
| `Work Email` | Primary HR join key |
| `Full Name` | Tier 3 name matching |
| `First Name` | Tier 3 name matching |
| `Last Name` | Tier 3 name matching |
| `Active/Inactive Status` | Employment status -- primary ex-employee signal |
| `Termination Date` | Confirms termination |
| `On Leave` | Leave status -- inactivity context |
| `Business Title` | Role context -- GTM Layer 3 title scan |
| `Division` | **GTM segmentation -- primary signal** |
| `Department` | **GTM Layer 2 elimination + analysis context** |
| `Manager's Work Email` | Output context for support tickets |
| `Region` | Output enrichment |
| `Product` | Instance product alignment check |
| `Worker Type` | FTE vs contractor distinction |
| `Worker Sub-Type` | Additional worker classification |
| `Acquisition Company` | Legacy account identification (acquired employees) |
| `Hire Date` | Tenure context |

---

## 3. Email Normalization Cascade

**Purpose:** Resolve every usage platform user to a canonical `@company.com` email for HR system join.  
**Input fields used:** `user_email`, `username`, `first_name`, `last_name`

### Five Failure Modes Handled

| # | Failure Mode | Example | Fix |
|---|---|---|---|
| 1 | Instance domain suffix in username | `david@company.com.instanceb` | Strip `.instanceb` (or `.instancec`, `.instanced`, `.instancee`) suffix |
| 2 | Non-company domain | `sarah@subsidiary.com` | Swap domain to `@company.com` |
| 3 | Plus-addressing alias | `user+sfcore@company.com` | Strip `+anything` before `@` |
| 4 | Username != actual name format | `david.jones@company.com` (real: David Smith) | Cannot fix via email -- fall through to name match |
| 5 | Non-standard username | `davidj` instead of `david.jones` | Cannot fix via email -- fall through to name match |

### Resolution Steps (run in order, stop at first match)

```
STEP 1 -- Build normalized email candidates from user_email:
  Candidate A: user_email as-is
  Candidate B: user_email with +alias stripped
  Candidate C: username with instance suffix stripped -> @company.com
  Candidate D: user_email with domain swapped to @company.com
  Candidate E: Candidate D with +alias also stripped

STEP 2 -- HR system email match
  Try all candidates against HR system Work Email column
  First match found -> MATCHED (record which candidate succeeded)

STEP 3 -- Full name match (fallback)
  Use first_name + last_name directly from usage platform
  Normalize: lowercase, trim whitespace, handle accents
  Match against HR system Full Name
  Exactly one match -> MATCHED (flag: "name-match -- verify recommended")
  Multiple matches -> AMBIGUOUS -> Human Review queue
  Zero matches -> proceed to Step 4

STEP 4 -- Not found classification
  Check username against integration patterns (see Section 6)
  Pattern match found -> INTEGRATION USER -> Excluded tab
  No pattern match -> check HR Active/Inactive Status + Termination Date
    Terminated / Inactive -> EX-EMPLOYEE -> Priority Remove tab
    Not found anywhere -> UNRESOLVED -> Human Review tab
```

---

## 4. Activity Field Hierarchy

### Instance A (third-party integration skews top-level fields)
| Priority | Field | Reason |
|---|---|---|
| Deprioritized | `last_activity_date` | Skewed -- integration logins count as application activity |
| Deprioritized | `monthly_logins` | Skewed -- same reason |
| PRIMARY | `crm_last_activity_date` | Core CRM object activity -- reliable |
| PRIMARY | `platform_last_activity_date` | Standard object activity -- reliable |
| PRIMARY | `platform_days_active_last_90` | Days active on standard objects (90-day window) |
| SUPPORTING | `permission_sets` | Feature engagement signal -- populated array = engaged user |

### All Other Instances
| Priority | Field | Reason |
|---|---|---|
| PRIMARY | `last_activity_date` | Reliable -- no integration skew |
| PRIMARY | `monthly_logins` | Reliable -- no integration skew |
| PRIMARY | `crm_last_activity_date` | Core CRM activity |
| PRIMARY | `crm_days_active_last_90` | Days active on core CRM (90-day window) |
| PRIMARY | `platform_last_activity_date` | Standard object activity |
| PRIMARY | `platform_days_active_last_90` | Days active on standard objects (90-day window) |

### DaysActive Threshold
- Window = **90 days** (confirmed from data -- max observed value = 90)
- Value of `0` = zero active days in last 90 days
- Value of `90` = active every day in last 90 days

### Combined Signal Decision Logic
```
BOTH primary date fields old + BOTH DaysActive = 0:
  -> Strong inactivity signal -- qualifies for removal per mode threshold

ONE date field recent + high DaysActive / populated permissionSets,
OTHER date field old + DaysActive = 0:
  -> Discrepancy -- flag as HUMAN REVIEW
  -> Agent explains the discrepancy in reasoning field
  -> Never auto-classify in either direction

BOTH fields show recent activity + DaysActive > 0:
  -> Active user -- retain, exclude from all lists

Created within last 30 days (account_created_date):
  -> EXCLUDE from analysis entirely -- too new to assess
```

---

## 5. Clean-Up Modes

### Mode Definitions

| Mode | Inactivity Threshold | Scope | GTM Handling |
|---|---|---|---|
| **Standard** | 60+ days inactive | Non-GTM first, GTM only if still needed | Always consult before action |
| **Urgent** | 30+ days inactive | All departments including GTM | Always consult before action |
| **Critical** | No threshold -- all users | All departments | Always consult before action |

### Clean-Up Types

| Type | Trigger | License Target | Default Mode |
|---|---|---|---|
| **Routine** | Monthly, proactive | Maximize removals | Standard |
| **On-demand** | License shortage, reactive | Minimum X needed -- but always maximize | Urgent or Critical |

### Run Inputs (required at start of every analysis)
1. Clean-up type: Routine / On-demand
2. If On-demand: minimum licenses needed
3. Mode: Standard / Urgent / Critical

### Output Prioritization
- Always surface maximum removable users
- For On-demand runs: rank output by lowest-risk first so minimum target can be hit quickly
- Assessment order: ascending by last activity date (longest inactive reviewed first)

---

## 6. Integration User Patterns

Users matching any of these patterns are **excluded from all analysis** and logged in the Excluded tab. Never action these accounts.

```
Keyword patterns (case-insensitive, match anywhere in email or userName):
  integration, api-user, bot, system,
  service, data.integrations, connector, automation
```

---

## 7. User Classification Framework

Every user is classified into exactly one of the following categories:

| Classification | Description | Output Tab | Action |
|---|---|---|---|
| **Direct Remove** | Inactive per mode threshold, non-GTM, no exceptions | Direct Remove | Submit support ticket |
| **Notify First** | Inactive per mode threshold, requires notification before removal | Notify First | Send notification, await response (5-7 business days) |
| **Ex-Employee** | Not in HR system (Inactive/Terminated) + not integration account | Ex-Employee | Priority support ticket -- offboarding failure |
| **GTM -- Consult Required** | Meets inactivity threshold but GTM division | GTM Flagged | Human consult with manager before any action |
| **Cross-Instance Anomaly** | GTM user whose Product doesn't match this instance | GTM Flagged | Flag for review -- verify business need |
| **Prior Exception** | Meets inactivity criteria but has documented business justification | Prior Exception | Human decides -- justification shown in output |
| **Human Review** | Borderline case, ambiguous name match, or discrepant signals | Human Review | Human verifies before any action |
| **Excluded** | Integration/service account | Excluded | Never action |
| **New User** | Created within last 30 days | Excluded | Never action -- too new to assess |

---

## 8. GTM Decision Framework (Multi-Layer)

Applied to every matched, non-integration user.

### Division Reference (from HR system)

| Division | GTM Status | Notes |
|---|---|---|
| Sales | GTM -- ALL departments | All departments |
| Customers | Partial -- see Layer 2/3 | Mix of GTM and non-GTM |
| Marketing | Non-GTM | All departments |
| Operations | Non-GTM | All departments |
| Product | Non-GTM | All departments |
| Technology | Non-GTM | All departments |
| CEO | Non-GTM | Executive org |

### Layer Decision Tree

```
LAYER 1 -- Division check
  Sales -> GTM. Full protection. Skip to Layer 4.
  CEO / Marketing / Operations / Product / Technology -> Non-GTM. Skip to inactivity.
  Customers -> Proceed to Layer 2.

LAYER 2 -- Department elimination (Customers division only)
  Support -> Non-GTM
  Protected departments (configurable) -> Flag for review (see Section 9)
  Engagement / Field Support / Launch Services / Professional Services
    -> Proceed to Layer 3.

LAYER 3 -- Business Title scan (Customers division, ambiguous depts)
  GTM titles (consult before action):
    Account Manager, Account Executive, Account Management,
    Client Success, Customer Success, Implementation Consultant,
    Implementation Manager, Launch, Onboarding, Trainer, Client Trainer,
    Solutions Consultant, Technical Consultant, Strategic Implementation,
    Field Implementation, Engagement, Industry Advocacy,
    Product Specialist (customer-facing), Revenue, GTM, Partner
  Non-GTM titles (proceed to inactivity analysis):
    Support Specialist, Support Associate, Support Manager,
    Support Representative, Technical Support

LAYER 4 -- Instance product alignment (non-Instance A only)
  GTM + Product matches instance -> Expected access. Standard GTM protection.
  GTM + Product does NOT match -> FLAG: cross-instance anomaly. Human review.
  Non-GTM + Product matches -> Standard inactivity analysis.
  Non-GTM + Product does NOT match -> Priority removal candidate.
```

---

## 9. Protected Departments

Certain departments are configured as "protected" -- non-GTM for analysis purposes but never directly actioned. These users:
- Are treated as **Non-GTM** for analysis purposes
- Are **never directly actioned** -- always surfaced in Human Review tab
- Agent must include note: "Protected department -- verify access requirement before actioning"

The list of protected departments is configurable per instance.

---

## 10. Instance Product Alignment Rules

| Instance | Expected Product Value(s) | Users from other products |
|---|---|---|
| Instance A | All products -- no filter | No anomaly flagging |
| Instance B | Product B | Flag as cross-instance anomaly |
| Instance C | Product C | Flag as cross-instance anomaly |
| Instance D | Product D | Flag as cross-instance anomaly |
| Instance E | Product E | Flag as cross-instance anomaly |

---

## 11. Prior Exception Register

Users in this register who meet inactivity criteria are surfaced in the **Prior Exception tab** with their justification shown. Human decides whether to action or retain. These are never auto-actioned.

Populated per-instance as clean-up cycles are conducted. Example entries (demo data):

| User Email | Name | Role | Business Justification | Recommended Action |
|---|---|---|---|---|
| jane.doe@company.com | Jane Doe | Financial Analyst | Accesses CRM data for quarterly financial reporting | Keep -- flag if inactive |
| bob.smith@company.com | Bob Smith | Marketing Specialist | Accesses CRM records for case study research | Keep -- flag if inactive |
| alice.chen@company.com | Alice Chen | Support Specialist | Weekend coverage -- access during limited staffing windows | Can remove with manager confirmation |

---

## 12. Notify vs Direct Remove Rules

Determination is **system-specific and evolving**. Current principle:

| User Category | Action |
|---|---|
| Non-GTM, clear inactivity, standard departments | Direct Remove |
| Non-GTM, borderline inactivity | Notify First |
| GTM (any inactivity level) | Consult Required -- never direct action |
| Protected department | Human Review -- never direct action |
| Prior Exception register | Human Review -- show justification |
| Ex-employee | Priority Direct Remove -- offboarding failure |
| Cross-instance anomaly | Human Review -- verify business need |

**Notification format (sent by analyst, not automated in Phase 1):**
> "Hello! I'm cleaning up licenses for [Instance] as we're running low on seats. I can see that you've been inactive. Do you have any objections to me removing your access? If you need to keep your access, please justify why. If access is needed sporadically, we'd remove it now but you can request it back anytime via a ticket. Thanks!"

**Follow-up window:** 5-7 business days. If no response, proceed with removal.

---

## 13. Ticket Output Format

**Content:** Plain text email list, one email per line  
**Ticket header:** Must include month of clean-up for tracking  
**Deadline:** Requests must be submitted at least one week in advance

**Output from agent:** Analyst checks off individual users per tab -> Confirm Selected generates email list from checked users only. Actioned users logged in DB. Unchecked users logged as deferred.

---

## 14. Output Tabs -- Summary

Every action tab includes a **checkbox per row** for selective actioning and a **delta badge** showing how this user's status changed since the previous run. Clicking any row opens the **User History Panel** showing the user's complete timeline on this instance.

| Tab | Contents | Export Format |
|---|---|---|
| Direct Remove | Inactive non-GTM users meeting full removal criteria | Plain text email list from checked users only (ticket ready) |
| Notify First | Inactive users requiring notification before removal | Plain text email list from checked users only |
| Ex-Employee | Users absent from HR system (terminated/inactive) | Plain text email list from checked users only |
| GTM Flagged | GTM users with inactivity signals + cross-instance anomalies | CSV with full context |
| Prior Exception | Inactive users with documented business justification | CSV with justification shown |
| Human Review | Borderline, ambiguous matches, protected departments, discrepant signals | CSV with agent reasoning |
| Excluded | Integration/service accounts + new users | CSV for audit |

### Delta Summary Bar (above tabs, below Analysis Summary Card)

Shows counts per delta category for the current run vs the previous run for this instance:
- **Newly Inactive:** N users (primary review focus)
- **Persistently Inactive:** N users (faster review -- seen before)
- **Recovered:** N users (self-corrected -- no action needed)
- **Reappeared:** N users (re-provisioned after previous removal -- investigate)
- **Net New:** N users (first appearance in any run for this instance)

Each count is clickable -- filters the view to show only that delta category across all tabs. Baseline runs show "Baseline run -- no previous data to compare."

---

## 15. Per-User Output Fields

Every user in every tab includes:

| Field | Source |
|---|---|
| `email` | HR system Work Email (canonical) |
| `fullName` | HR system Full Name |
| `department` | HR system Department |
| `division` | HR system Division |
| `businessTitle` | HR system Business Title |
| `region` | HR system Region |
| `product` | HR system Product |
| `managerEmail` | HR system Manager's Work Email |
| `onLeave` | HR system On Leave |
| `workerType` | HR system Worker Type |
| `acquisitionCompany` | HR system Acquisition Company |
| `sfCreatedDate` | Usage platform account_created_date |
| `lastActivityDate` | Usage platform last_activity_date |
| `monthlyActivity` | Usage platform monthly_logins |
| `sfLastActivityDate` | Usage platform crm_last_activity_date |
| `sfDaysActive` | Usage platform crm_days_active_last_90 |
| `platformLastActivityDate` | Usage platform platform_last_activity_date |
| `platformDaysActive` | Usage platform platform_days_active_last_90 |
| `permissionSets` | Usage platform permission_sets |
| `profile` | Usage platform user_profile |
| `classification` | Agent output |
| `confidenceLevel` | Agent output: high / medium / low |
| `matchTier` | Normalization tier used: 1 / 2 / 3 / unresolved |
| `reasoning` | Agent output: 1-2 sentence plain English explanation |
| `actionStatus` | App state: pending / actioned / deferred |
| `deltaCategory` | App computed: newly_inactive / persistently_inactive / recovered / reappeared / net_new / null (baseline) |
| `previousClassification` | App computed: classification from previous run, null if baseline |
| `sporadicFlag` | App lookup: true if user has active sporadic/temporary access flag on this instance |

---

## 16. Sporadic/Temporary Access Register

**Separate from the Prior Exception Register.** These serve different purposes:
- **Prior Exception** = "Don't remove -- standing business need." User is protected from removal.
- **Sporadic Flag** = "Remove when inactive, but this user has a pattern of temporary/project-based access." User is NOT protected -- the flag provides context only.

The sporadic flag does NOT predict whether a user will return. It records the observed pattern of temporary access needs.

### Per-Instance Scoping

A user can be sporadic on Instance A but permanent on Instance B. The flag exists at the `[userEmail, instanceName]` level.

### How Sporadic Flags Are Used in Analysis

1. Sporadic-flagged users who meet inactivity criteria still appear in their normal action tab (Direct Remove, Notify First, etc.)
2. Their row includes a badge: "Known temporary/project-based access" with note and removal history
3. When a sporadic user reappears after removal, delta category = "Reappeared" with softer context
4. User History Panel shows complete removal/re-provisioning timeline

### How Sporadic Flags Are Created

- Via Review Chat: "Flag user as temporary access -- quarter-end reconciliation"
- Via User History Panel: click "Flag as Temporary/Project-Based Access" button, add note

---

## 17. Open Items -- To Be Refined Over Time

| # | Item | Notes |
|---|---|---|
| 1 | Formal inactivity thresholds per instance | Currently using 60-day (Standard) / 30-day (Urgent) as baseline. Agent data will inform refinement. |
| 2 | Notify vs Direct Remove department-level rules | Currently principle-based. Will formalize per instance after first clean-up cycles. |
| 3 | Prior exception register for non-primary instances | Not yet documented. Add as clean-ups are conducted. |
| 4 | GTM title list completeness | Current list covers known titles. Agent flags unknown Customer-division titles for human review. |
| 5 | Sporadic register population | Empty at launch. Populated organically through analyst review over first clean-up cycles. |
| 6 | Delta analysis mode mismatch handling | When consecutive runs use different modes (Standard vs Urgent), delta comparison still works but threshold-driven newly inactive users need context. |
