# SaaS License Clean-Up Agent

An AI-powered web application that automates SaaS license clean-up analysis. Upload two CSVs (usage platform export + HR system data), and the agent classifies every user into one of 9 categories with plain-English reasoning. The analyst reviews the output and selectively confirms actions -- the tool never removes users automatically.

**Built to solve a real problem:** recurring license clean-ups that took ~2 hours of manual spreadsheet work, compressed to minutes with full audit trail and institutional memory that compounds over each run.

> **Live demo:** [license-cleanup-agent.onrender.com](https://license-cleanup-agent.onrender.com) (free tier -- ~30s cold start)
> Login: `admin@company.com` / `changeme123` | Demo CSVs in [`demo/`](demo/)

---

## What It Does

```
Upload CSVs  -->  Parse & Deduplicate  -->  Email Normalization  -->  HR Enrichment
     |                                                                       |
     v                                                                       v
Exclude new users              GTM Multi-Layer Framework  <--  Prior Exceptions Check
& integrations                         |                      Sporadic Flags Check
                                       v
                              AI Classification  -->  Delta Comparison
                                       |              (vs previous run)
                                       v
                              7-Tab Results with Checkboxes  -->  Analyst Review
                                       |                              |
                                       v                              v
                              Confirm Selected  -->  Email List + Audit Log
```

### 9 User Classifications

| Classification | Action |
|---|---|
| **Direct Remove** | Submit support ticket |
| **Notify First** | Notification, then 5-7 day window |
| **Ex-Employee** | Priority ticket -- offboarding failure |
| **GTM -- Consult Required** | Consult manager before action |
| **Cross-Instance Anomaly** | Verify business need |
| **Prior Exception** | Show justification, human decides |
| **Human Review** | Human verifies borderline case |
| **Excluded** | Integration/service accounts, new users |
| **Unresolved** | Manual investigation required |

---

## Key Features

- **AI-powered classification** with per-user plain-English reasoning (Anthropic Claude API, with deterministic fallback when no API key is configured)
- **Email normalization cascade** -- 5-mode resolution (instance suffix stripping, domain swapping, plus-alias handling, name-based fallback) to join usage data to HR records
- **GTM decision framework** -- multi-layer classification using Division > Department > Business Title > Product alignment to protect revenue-facing users
- **Delta analysis** -- run-over-run comparison tracking newly inactive, persistently inactive, recovered, reappeared, and net new users
- **Selective actioning** -- per-user checkboxes with every accept/defer decision logged for audit
- **Sporadic access register** -- flags users with temporary/project-based access patterns, tracks removal and re-provisioning history
- **User history timeline** -- per-user panel showing all past analysis appearances, actions, flags, and chat overrides
- **Review chat** -- post-analysis conversation for reclassifying users, adding exceptions, flagging sporadic users, and querying results
- **Living access criteria** -- per-instance criteria documents with versioning and AI-assisted updates
- **System onboarding** -- self-serve flow for adding new SaaS systems, generates a Reasoning Table from sample data
- **Full audit trail** -- every run, classification, and action decision recorded with analyst identity

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | TypeScript, Express 5, Node.js |
| Frontend | React 19, Vite |
| Database | PostgreSQL 15, Prisma ORM (14 models) |
| AI | Anthropic Claude API (optional -- deterministic fallback) |
| Auth | Email/password with signed tokens + role-based authorization |
| Deployment | Docker (multi-stage build), Render, Docker Compose |

**~9,000 lines** of TypeScript/React/CSS across 10 API route files, 7 core pipeline modules, 2 intelligence modules, and 13 React components.

---

## Architecture

```
src/
├── server.ts                 # Express app, route mounting, static serving
├── middleware/
│   ├── auth.ts               # Token verification + AppUser lookup
│   └── requireAdmin.ts       # Admin-only route guard
├── routes/                   # 10 route files (auth, analysis, chat, admin, etc.)
├── core/                     # Pipeline modules
│   ├── emailNormalizer.ts    # 5-mode email resolution cascade
│   ├── hrEnricher.ts         # HR system join + GTM classification
│   ├── classifier.ts         # Rule-based classification engine
│   ├── deltaComparison.ts    # Run-over-run comparison (5 delta categories)
│   ├── actionTracker.ts      # Selective actioning + audit logging
│   ├── sporadicFlagService.ts
│   └── userHistoryService.ts
└── intelligence/             # AI layer
    ├── foundationalKnowledge.ts  # Domain knowledge seeding
    └── reasoningEngine.ts        # Claude API integration + batch processing

frontend/src/
├── App.tsx                   # Auth state machine + view routing
├── lib/api.ts                # Token management + authenticated fetch
└── components/               # 13 components (results, chat, history, admin, etc.)
```

### Analysis Pipeline (16 steps)

1. Parse both CSVs
2. Deduplicate usage platform rows
3. Exclude new users (< 30 days)
4. Identify + exclude integration accounts
5. Run email normalization cascade
6. Enrich with HR data
7. Apply GTM decision framework
8. Apply instance product alignment
9. Check prior exception register
10. Check sporadic flag register
11. Send to AI reasoning engine
12. Receive classifications + reasoning
13. Save run + results to DB
14. Delta comparison vs previous run
15. Write user history events
16. Return structured output (7 tabs + delta summary)

---

## Running Locally

### Prerequisites

- Docker and Docker Compose
- (Optional) Anthropic API key for AI features

### Quick Start

```bash
# Clone the repo
git clone https://github.com/mahdeen-reza/license-cleanup-agent.git
cd license-cleanup-agent

# Create .env from template
cp .env.example .env

# Start everything
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up
```

App at `http://localhost:3000`. PostgreSQL at `localhost:5432`.

Prisma migrations and seed data run automatically on startup. Default login: `admin@company.com` / `changeme123`.

### Demo Walkthrough

1. Log in with demo credentials
2. Upload both CSVs from [`demo/`](demo/) (Instance B, Standard mode, Routine)
3. Run analysis -- 37 users classified across all 9 categories
4. Review results across 7 tabs, check users for action
5. Open User History panel on any row
6. Try the Review Chat to reclassify or query results
7. Visit Knowledge Base to view access criteria

See [`demo/README.md`](demo/README.md) for expected results and edge cases covered.

### Without Docker

```bash
npm install
npx prisma migrate deploy
npx prisma db seed
npm run build          # builds frontend
npm start              # starts Express on port 8000
```

Requires a PostgreSQL instance and `DATABASE_URL` in `.env`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `TOKEN_SECRET` | Yes | Secret for signing auth tokens |
| `NODE_ENV` | Yes | `production` or `development` |
| `ANTHROPIC_API_KEY` | No | Enables AI classification -- deterministic fallback without it |
| `ANTHROPIC_MODEL` | No | Model ID (default: `claude-sonnet-4-20250514`) |
| `DEV_USER_EMAIL` | No | Auto-login fallback for local dev |

---

## Design Decisions

- **HR-system-primary** -- HR data is authoritative for all employee information, overriding usage platform fields
- **Conservative by design** -- borderline cases route to Human Review. Wrong removal cost > missed removal cost.
- **Reasoning on every user** -- plain English explanation stored in DB, defensible in escalations
- **Selective actioning** -- analyst curates action list per-user, never bulk. Every accept/defer logged.
- **Delta analysis compounds memory** -- each run builds on the last. Review surface shrinks over time.
- **Sporadic != Exception** -- sporadic users get removed when inactive (correct) but the tool remembers the pattern. Exceptions are protected entirely.
- **AI is optional** -- the app runs fully without an API key using deterministic classification

---

## Project Documentation

| File | Purpose |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project context, critical rules, and constraints |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full technical reference -- schemas, normalization, DB models, API routes |
| [`PRD.md`](PRD.md) | Product requirements, user flows, success metrics |
| [`docs/RULES_DECISION_TABLE.md`](docs/RULES_DECISION_TABLE.md) | Complete analysis logic, GTM framework, classification rules |
| [`demo/README.md`](demo/README.md) | Demo data documentation with expected results |

---

## License

[MIT](LICENSE)
