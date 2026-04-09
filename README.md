# SaaS License Clean-Up Agent

**Status:** Phase 1 -- Salesforce (5 instances)

---

Internal web application that automates the analysis phase of SaaS license clean-ups. An analyst uploads two CSV exports (usage platform user data + HR system employee data), selects an instance and mode, and the agent classifies every user into one of 9 categories with plain-English reasoning. The analyst reviews the output and selectively confirms actions -- the tool never removes users automatically.

## Key Features

- **Automated classification** -- 9 user categories (Direct Remove, Notify First, Ex-Employee, GTM Flagged, Cross-Instance Anomaly, Prior Exception, Human Review, Excluded, Unresolved) with per-user reasoning
- **GTM decision framework** -- Multi-layer classification using Division, Department, Business Title, and Product alignment to protect revenue-facing users
- **Email normalization** -- Multi-mode cascade resolving usage platform emails to canonical HR system identities, including instance suffix stripping, domain swapping, plus-alias handling, and name-based fallback
- **Delta analysis** -- run-over-run comparison tracking newly inactive, persistently inactive, recovered, reappeared, and net new users across runs
- **Selective actioning** -- per-user checkboxes with every accept/defer decision logged for audit
- **Sporadic access register** -- flags users with temporary/project-based access patterns, tracks removal and re-provisioning history
- **User history timeline** -- per-user panel showing all past analysis appearances, actions, flags, and chat overrides
- **Review chat** -- post-analysis conversation for reclassifying users, adding exceptions, flagging sporadic users, and querying results
- **Living access criteria** -- per-instance criteria documents with versioning and AI-assisted updates
- **System onboarding** -- self-serve flow for adding new systems (Phase 2), generates a Reasoning Table from sample data
- **Full audit trail** -- every run, classification, and action decision recorded with user identity

## How It Works

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

## Supported Instances

| Instance | Product Filter |
|---|---|
| Instance A | None (all products) |
| Instance B | Product B |
| Instance C | Product C |
| Instance D | Product D |
| Instance E | Product E |

## Stack

- **Backend:** TypeScript + Express (port 8000)
- **Frontend:** React + Vite (built and served statically by Express)
- **Database:** PostgreSQL 15 with Prisma ORM
- **AI:** Anthropic Claude API for classification reasoning
- **Auth:** Email-based authentication + AppUser authorization table
- **Deployment:** Docker Compose (single container)

## Project Structure

```
license-cleanup-agent/
├── CLAUDE.md                     # Project context and critical rules
├── ARCHITECTURE.md               # Technical depth -- schemas, normalization, DB models
├── PRD.md                        # Product requirements and user flows
├── docs/RULES_DECISION_TABLE.md  # Analysis logic and GTM framework
├── Dockerfile                    # Multi-stage build (frontend + backend)
├── docker-compose.yaml           # Production
├── docker-compose.dev.yaml       # Local dev overlay
├── .env.example                  # Environment variable template
├── prisma/
│   ├── schema.prisma             # 14 models
│   └── migrations/               # Committed migrations
├── src/
│   ├── server.ts                 # Express app, route mounting, static serving
│   ├── lib/                      # prisma.ts, ai.ts (Anthropic Claude client)
│   ├── middleware/                # auth.ts, requireAdmin.ts
│   ├── routes/                   # auth, me, systems, onboarding, analysis, chat,
│   │                             #   actioning, sporadicFlags, userHistory, admin
│   ├── core/                     # emailNormalizer, hrEnricher, classifier,
│   │                             #   deltaComparison, actionTracker, sporadicFlagService,
│   │                             #   userHistoryService
│   └── intelligence/             # foundationalKnowledge, reasoningEngine
└── frontend/
    └── src/
        ├── App.tsx               # Main app with view routing
        ├── types.ts              # Shared TypeScript types
        ├── index.css             # Dark mode theme
        └── components/           # 12 React components
```

## Deployment

Configured for Docker Compose deployment.

1. Create a `.env` file based on `.env.example`
2. Run `docker compose up -d`

Prisma migrations run automatically on container startup. The Anthropic API key is optional -- the app runs with a mock fallback (all users classified as Human Review) if the key is absent.

## Local Development

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d
```

App available at `http://localhost:3000`. PostgreSQL at `localhost:5432`.

After making frontend changes, rebuild locally:

```bash
cd frontend && npm run build
```

The dev overlay volume-mounts the project directory into the container, so the rebuilt `frontend/dist/` is picked up immediately.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `POSTGRES_USER` | Yes | Database user (used by db service) |
| `POSTGRES_PASSWORD` | Yes | Database password (used by db service) |
| `POSTGRES_DB` | Yes | Database name (used by db service) |
| `NODE_ENV` | Yes | `production` or `development` |
| `ANTHROPIC_API_KEY` | No | Anthropic API key -- app runs with mock fallback if absent |
| `DEV_USER_EMAIL` | No | Fallback email for local dev only |

## Auth

Two layers:

1. **Authentication** -- Identity extracted from request header or `DEV_USER_EMAIL` fallback in development.
2. **App-level authorization** -- Users must be provisioned in the `AppUser` table. Two roles: `admin` (full app + user management) and `standard` (full app usage).

In local development, the `DEV_USER_EMAIL` env var is used as fallback when the auth header is absent, and a missing AppUser is auto-created as admin.

## Phase 2

Expand to additional systems using the self-serve onboarding flow built in Phase 1. Same app, same infrastructure -- no new deployment required.
