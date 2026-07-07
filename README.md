# CarerScribe — AI Companion for NDIS

A production-grade, multi-tenant clinical management platform built for Australian NDIS (National Disability Insurance Scheme) support providers. It combines real-time session documentation, an AI compliance engine, and NDIS funding tracking in a single system.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Environment Variables](#environment-variables)
5. [Running Locally](#running-locally)
6. [Monorepo Structure](#monorepo-structure)
7. [Backend Deep-Dive](#backend-deep-dive)
8. [Frontend Deep-Dive](#frontend-deep-dive)
9. [Database Schema](#database-schema)
10. [Multi-Tenancy & RBAC](#multi-tenancy--rbac)
11. [Auth Flow](#auth-flow)
12. [AI & Compliance Engine](#ai--compliance-engine)
13. [NDIS Funding Tracker](#ndis-funding-tracker)
14. [API Routing (Proxy Architecture)](#api-routing-proxy-architecture)
15. [Generated API Client](#generated-api-client)
16. [Known Constraints & Workarounds](#known-constraints--workarounds)
17. [Database Migrations](#database-migrations)
18. [Performance Testing](#performance-testing)

---

## Architecture Overview

```
Browser / Mobile App
        │
        ▼
  ┌─────────────────────────────┐
  │   Node/Express API Server   │  ← port 8080 (Replit preview proxy entry)
  │   artifacts/api-server      │
  │   Reverse proxy only        │
  └────────────┬────────────────┘
               │  /api/* proxied
               ▼
  ┌─────────────────────────────┐
  │   Python FastAPI Backend    │  ← port 8000
  │   backend/                 │
  │   Business logic + AI       │
  └────────────┬────────────────┘
               │
               ▼
  ┌─────────────────────────────┐
  │   Supabase (PostgreSQL)     │  ← external, managed
  │   Auth + DB + RLS           │
  └─────────────────────────────┘

  ┌─────────────────────────────┐
  │   React Frontend            │  ← port 18130 (Vite dev server)
  │   artifacts/frontend        │
  └─────────────────────────────┘

  ┌─────────────────────────────┐
  │   Expo Mobile App           │  ← port from $PORT
  │   artifacts/mobile          │
  └─────────────────────────────┘
```

**Request flow:** The Replit preview proxy routes everything to the `api-server` on port 8080. The `api-server` reverse-proxies `/api/*` to the FastAPI backend on port 8000. The frontend Vite dev server also has its own `/api` proxy to port 8000 for local development.

> **Important:** The Express proxy middleware runs *before* body-parsing middleware so `POST`/`PATCH` bodies are forwarded correctly.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Wouter |
| Backend | Python 3.11+, FastAPI, Pydantic v2, Supabase Python SDK |
| Database | Supabase (PostgreSQL), Row-Level Security, PostgREST |
| Auth | Supabase Auth (JWT) + custom role resolution via `organization_members` |
| AI | OpenAI GPT-4o-mini (summaries, compliance scoring, clinical rewrites) |
| Mobile | Expo (React Native) via pnpm workspace |
| API Gateway | Node.js / Express (reverse proxy only — no business logic) |
| Package Manager | pnpm (workspace monorepo) |
| Shared Libs | `@workspace/api-client-react` (React Query hooks), `@workspace/api-zod` (Zod schemas) |

---

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`npm install -g pnpm`)
- **Python** 3.11+
- A **Supabase** project with the schema applied (see [Database Migrations](#database-migrations))
- An **OpenAI** API key

---

## Environment Variables

All secrets are stored as Replit secrets or in a local `.env` file at the workspace root (never commit this file).

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key — bypasses RLS for admin operations |
| `OPENAI_API_KEY` | ✅ | OpenAI key for GPT-4o-mini |
| `SESSION_SECRET` | ✅ | Express session secret (API gateway) |
| `SECRET_KEY` | ✅ | FastAPI JWT signing key |
| `FRONTEND_BASE_URL` | optional | Used for email redirect links; defaults to `http://localhost` |
| `AUTH_AUTO_CONFIRM_EMAIL` | optional | Set `true` in local/dev to skip email verification |

The Python backend loads these from the environment via `backend/app/core/config.py` (`Settings` class using pydantic-settings).

---

## Running Locally

### 1. Install dependencies

```bash
pnpm install
pip install -r backend/requirements.txt
```

### 2. Apply the database schema

Open your Supabase SQL editor and run `backend/supabase_setup.sql` in full. This is idempotent — re-running it is safe.

> For migrations applied after the initial setup (new columns, new tables), individual `ALTER TABLE` statements are at the bottom of `supabase_setup.sql` and are guarded with `IF NOT EXISTS`.

### 3. Start services

Each service is an independent process. In Replit these are managed as workflows; locally run them in separate terminals:

```bash
# Terminal 1 — Python backend
cd backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Node API gateway (proxy)
cd artifacts/api-server && PORT=8080 node --enable-source-maps dist/index.mjs

# Terminal 3 — React frontend
pnpm --filter @workspace/frontend run dev

# Terminal 4 — Mobile (optional)
pnpm --filter @workspace/mobile run dev
```

### 4. Access the app

- Frontend: `http://localhost:18130`
- Backend API docs (Swagger): `http://localhost:8000/docs`

---

## Monorepo Structure

```
/
├── artifacts/
│   ├── frontend/          # React + Vite web app
│   │   └── src/
│   │       ├── components/    # Shared UI components (shadcn + custom)
│   │       ├── contexts/      # AuthContext, QueryClient setup
│   │       ├── hooks/         # React Query data hooks
│   │       ├── pages/         # One file per route
│   │       └── App.tsx        # Router + RBAC guards
│   ├── api-server/        # Express reverse proxy (no business logic)
│   └── mobile/            # Expo React Native app
├── backend/
│   └── app/
│       ├── api/           # FastAPI routers (one file per domain)
│       ├── core/          # Config, security (JWT), middleware
│       ├── models/        # Pydantic response models
│       ├── schemas/       # Pydantic request schemas
│       └── services/      # Business logic, DB calls, AI
├── lib/
│   ├── api-client-react/  # Generated TanStack Query hooks
│   ├── api-zod/           # Generated Zod schemas
│   └── api-spec/          # OpenAPI spec (source of truth for codegen)
├── backend/supabase_setup.sql   # Full DB schema + seed
└── pnpm-workspace.yaml
```

---

## Backend Deep-Dive

### Routers (`backend/app/api/`)

| File | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/api/auth` | Register, login, onboarding, password reset, email verification |
| `participants.py` | `/api/participants` | CRUD for NDIS participants (patients), plan setup, AI summaries |
| `sessions.py` | `/api/sessions` | Session CRUD, live session save-with-AI, compliance run |
| `compliance.py` | `/api/compliance` | Run compliance engine on a session, retrieve audit logs |
| `incidents.py` | `/api/incidents` | Incident CRUD; workers see only their own, coordinators see org-wide |
| `ai.py` | `/api/ai` | Translate, clinical-rewrite, assess-note, explain-compliance endpoints |
| `reports.py` | `/api/reports` | Compliance overview, session audit reports |
| `billing.py` | `/api/billing` | Invoice generation and NDIS billing records |
| `budget_api.py` | `/api/budget` | Plan budget allocation and usage tracking |
| `invitations.py` | `/api/invitations` | Create/validate/accept team invite tokens |
| `alerts.py` | `/api/alerts` | Compliance alerts — list, mark read |
| `plans.py` | `/api/participants/{id}/plan` | NDIS plan creation and goal management |

### Services (`backend/app/services/`)

| File | Responsibility |
|---|---|
| `supabase_client.py` | Returns anon and admin Supabase clients |
| `ai_service.py` | GPT-4o-mini wrapper — summaries, translations, RP enrichment |
| `compliance_engine.py` | 8-rule heuristic engine + 70/30 blend with AI score |
| `participant_service.py` | Scoped participant queries (org + allocation filters) |
| `session_service.py` | Session CRUD with `updated_at` trigger workaround |
| `funding_service.py` | Budget usage recording, `plan_budgets.used_amount` updates |
| `incident_service.py` | Incident queries with worker-level scoping |
| `alert_service.py` | Alert fan-out on compliance failures |

---

## Frontend Deep-Dive

### Routing (`artifacts/frontend/src/App.tsx`)

Routes are guarded by the `ProtectedRoute` component which checks:
1. Auth status (redirect to `/login` if not logged in)
2. RBAC — certain routes are restricted to `admin` / `support_coordinator` roles

| Role | Accessible Routes |
|---|---|
| `admin` / `support_coordinator` | All routes including `/compliance`, `/reports`, `/patients/new`, `/team` |
| `support_worker` | `/dashboard`, `/my-clients`, `/sessions`, `/incidents`, `/settings` |

### Key Pages

| Page | Path | Notes |
|---|---|---|
| Dashboard | `/dashboard` | Live stats, recent sessions, compliance gauge, alert panel |
| Participants | `/patients` | Split-pane list + tabbed detail (Overview / Plan / History) |
| Live Session | `/sessions/:id/live` | Full-screen mobile-first; voice transcription, goal tracker, compliance score |
| Session Detail | `/sessions/:id` | Claim readiness, compliance rules breakdown, AI insights |
| Compliance Centre | `/compliance` | Audit score gauge, session audit log, most-common issues |
| Settings → Team | `/settings` | Invite members (admin/coordinator only), manage roles |
| Accept Invite | `/accept-invite` | Public route; accepts invite token, sets password |

### Data Fetching

All server state goes through **TanStack Query**. Hooks live in `artifacts/frontend/src/hooks/`. The generated hooks from `@workspace/api-client-react` are the preferred import — use those before writing a custom `useQuery`.

### Smart Input (Voice + AI)

`SmartInput` and `SmartTextarea` components wrap standard inputs with:
- Browser Web Speech API mic button (continuous, interim results)
- Mode pills post-dictation: **Raw | Translate | Clinical**
- Translate → `POST /api/ai/translate`
- Clinical → `POST /api/ai/clinical-rewrite`
- 30+ language auto-detection, result caching per transcript

---

## Database Schema

All tables live in Supabase PostgreSQL. The canonical schema is `backend/supabase_setup.sql`.

### Core Tables

| Table | Purpose |
|---|---|
| `auth.users` | Supabase-managed auth identities |
| `users` | Public profile, role, onboarding flags, `organization_id` |
| `organizations` | Multi-tenant root — every org-scoped record links here |
| `organization_members` | User ↔ org membership with a role (authoritative for JWT role) |
| `patients` | NDIS participants — clinical profile, `risk_level`, `biological_sex`, `ndis_plan_id` |
| `sessions` | Clinical sessions — notes, AI insights (JSONB), compliance score, `is_ready_for_billing` |
| `ndis_plans` | Plan dates, status (active/pending/expired), linked to a patient |
| `plan_budgets` | Budget allocation by support category (core / capacity_building / capital) |
| `budget_usage` | Per-session cost records |
| `support_items` | NDIS price guide seed data (9 items) |
| `compliance_audit_logs` | Rule-by-rule audit trail per session |
| `incidents` | Safety/clinical incidents; scoped by `organization_id` and `reporter_id` |
| `invitations` | Team invite tokens (email, role, org, expires_at, accepted_at) |
| `alerts` | Compliance and plan alerts |
| `patient_goals` | Active NDIS goals per participant, used in live session goal tracker |

### Supabase FK Join Workaround

PostgREST's relational join syntax (`patients(full_name)`) requires a registered FK in the schema cache, which can be unreliable. **All session service queries use a two-query pattern**: fetch sessions first, batch-fetch patient names by ID. Do not add PostgREST join syntax to `session_service.py`.

---

## Multi-Tenancy & RBAC

### How Tenancy Works

Every participant, session, incident, and plan is scoped by `organization_id`. Row-Level Security (RLS) policies on Supabase enforce this at the database layer — a query run with the anon key can only see rows matching the caller's org.

The backend uses the **service role key** (`SUPABASE_SERVICE_ROLE_KEY`) for administrative operations that intentionally bypass RLS (e.g., seeding `organization_members` at login, system-level audit logs). All other queries use the anon key scoped to the session user.

### Roles

| Role | Description |
|---|---|
| `admin` | Full access — all participants, sessions, billing, team management |
| `support_coordinator` | Same as admin minus owner-level org settings |
| `support_worker` | Only allocated participants + own sessions and incidents |

### Role Source of Truth

The role embedded in the JWT is resolved from `organization_members.role` at login time (not from `users.role`). This means an admin can change a user's role in the Team panel and it takes effect on their next login. See `auth.py` → `_resolve_org_member_role()`.

---

## Auth Flow

### Registration

1. `POST /api/auth/register` — admin `create_user` creates `auth.users` row first (avoids FK race), then upserts `public.users`.
2. Verification email sent unless `AUTH_AUTO_CONFIRM_EMAIL=true`.
3. User completes onboarding → `POST /api/auth/complete-onboarding` → creates `organizations` row (if `small_provider`), sets `organization_id` on user.

### Login

1. `POST /api/auth/login` — Supabase `sign_in_with_password`.
2. Fetch `public.users` profile (two-pass: extended columns → base columns fallback).
3. Resolve role from `organization_members` if `organization_id` is present.
4. Issue JWT containing `sub`, `email`, `role`, `account_type`, `organization_id`.

### Invite Flow

1. Admin sends invite: `POST /api/invitations/create` → inserts a row in `invitations` with a secure random token (24 h expiry).
2. Invitee opens `/accept-invite?token=X` → `GET /api/invitations/validate/{token}` (checks expiry).
3. Invitee sets password → `POST /api/invitations/accept/{token}` → creates Supabase auth user, upserts `users`, inserts `organization_members`, marks invite accepted.

---

## AI & Compliance Engine

### Compliance Engine (`compliance_engine.py`)

Eight heuristic rules evaluated on every session:

| # | Rule | Weight |
|---|---|---|
| 1 | Session duration present | pass/fail |
| 2 | Clinical notes not empty | pass/fail |
| 3 | Goals linked to session | pass/fail |
| 4 | Service type set | pass/fail |
| 5 | Outcome described in notes | pass/warn |
| 6 | Session within plan dates | pass/fail |
| 7 | No duplicate timestamps | pass/warn |
| 8 | Budget not exceeded | pass/warn |

Score = `(passed + warnings × 0.5) / total × 100`. This is blended 70/30 with the AI compliance score.

### AI Compliance Scoring (`POST /api/ai/assess-note`)

Called live from the session editor (debounced 2.5 s). Four GPT-4o-mini criteria:

| Criterion | Weight |
|---|---|
| Verified timestamp / active check-in | 25% |
| Semantic NDIS goal connection | 35% |
| Documented support outcome | 25% |
| Next-step / routine action logged | 15% |

Score ≥ 75 → `is_ready_for_billing = true` auto-patched on the session record.

### AI Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/ai/translate` | Translate dictated text to fluent English |
| `POST /api/ai/clinical-rewrite` | Rewrite in 3rd-person clinical NDIS format |
| `POST /api/ai/assess-note` | Live 4-criteria compliance scoring |
| `POST /api/ai/explain-compliance` | On-demand explanation + fix suggestions for failed rules |
| `GET /api/ai/summary/{participant_id}` | AI participant summary |

---

## NDIS Funding Tracker

- **Plan budgets** are allocated across three support categories: `core`, `capacity_building`, `capital`.
- **Session cost** is calculated from `duration × hourly_rate` mapped from the `support_items` price guide.
- `budget_usage` records one row per session; `plan_budgets.used_amount` is updated in real time.
- `NDISPlanCreate` validates `plan_end > plan_start`; plan `status` (active / pending / expired) is auto-derived from today's date — no manual override needed.

---

## API Routing (Proxy Architecture)

The Replit preview proxy routes all traffic to `api-server` on port 8080. The Express gateway then forwards:

| Path prefix | Forwarded to |
|---|---|
| `/api/participants` | FastAPI :8000 |
| `/api/sessions` | FastAPI :8000 |
| `/api/alerts` | FastAPI :8000 |
| `/api/compliance` | FastAPI :8000 |
| `/api/ai` | FastAPI :8000 |
| `/api/reports` | FastAPI :8000 |
| `/api/budget` | FastAPI :8000 |
| `/api/invitations` | FastAPI :8000 |
| `/api/auth` | FastAPI :8000 |
| `/*` (fallback) | React frontend static files |

The Vite dev server also has its own `/api` proxy to `:8000` configured in `artifacts/frontend/vite.config.ts` for direct dev access.

---

## Generated API Client

The OpenAPI spec lives at `lib/api-spec/openapi.yaml`. React Query hooks and Zod schemas are generated from it.

```bash
# Regenerate after changing the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

Generated output:
- `lib/api-client-react/src/generated/api.ts` — TanStack Query hooks
- `lib/api-zod/src/generated/` — Zod validation schemas

**Always use the generated hooks** in frontend components rather than raw `fetch`/`axios`. Add new endpoints to the OpenAPI spec first, regenerate, then consume the hook.

---

## Known Constraints & Workarounds

### `sessions.updated_at` trigger bug

The `sessions` table has a `BEFORE UPDATE` trigger that references `NEW.updated_at`, but that column does not exist. Direct `UPDATE` always fails with error code `42703`.

**Workaround** in `session_service.update_session()`: catches the `42703` error and falls back to a READ → MERGE → DELETE → INSERT operation.

**Permanent fix** (run in Supabase SQL editor):
```sql
ALTER TABLE sessions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
```

### Save-with-AI side-effect isolation

In `POST /api/sessions/:id/save-with-ai`, alert creation, budget recording, and audit logging are each wrapped in their own `try/except` so a FK or constraint failure in a side-effect never aborts the core AI + compliance pipeline.

### pnpm "run environment rebuild" timeout (Replit)

Replit's pre-run hook (`pnpm add pnpm@10.33.2`) can time out for the frontend workflow. The `.npmrc` is configured with `prefer-offline=true` to use cached packages. If the frontend workflow fails to start:
1. Stop the expo workflow from the Replit UI to free resources.
2. Restart the frontend workflow.

### PostgREST join syntax

Do not use PostgREST relational join syntax in `session_service.py`. Use the two-query pattern (fetch sessions, batch-fetch names) to avoid schema cache reliability issues.

---

## Database Migrations

The canonical file is `backend/supabase_setup.sql`. It is **idempotent** — every `CREATE TABLE` and `ALTER TABLE` is guarded.

To apply:
1. Go to your Supabase project → SQL Editor → New Query.
2. Paste the full contents of `backend/supabase_setup.sql`.
3. Click **Run**.

Key migrations that must be applied for all features:

| Feature | SQL Change |
|---|---|
| Onboarding | `ALTER TABLE users ADD COLUMN onboarding_complete ...` (and related columns) |
| NDIS Funding | Create `ndis_plans`, `plan_budgets`, `budget_usage`, `support_items`, `compliance_audit_logs` |
| Compliance Engine | `ALTER TABLE sessions ADD COLUMN compliance_status, cost, support_category, is_ready_for_billing` |
| Risk Profile | `ALTER TABLE patients ADD COLUMN risk_level, risk_triggers, risk_management_plan` |
| Gendered Body Map | `ALTER TABLE patients ADD COLUMN biological_sex` |
| RBAC | Create `organizations`, `organization_members`, `invitations` tables |
| Goals | Create `patient_goals` table |

---

## Performance Testing

Load tests use [k6](https://k6.io/) with **Coordinator + Worker** role scenarios and auto-generated HTML/JSON reports.

**Full setup and user guide:** [`performance/README.md`](performance/README.md)

### Quick start

```bash
# 1. Add K6_* credentials to .env (see .env.example)

# 2. Verify login
docker compose run --rm --entrypoint node k6 /app/performance/scripts/verify-auth.js

# 3. Run test (~2 min)
docker compose run --rm k6

# 4. Open report
xdg-open performance/reports/report.html
```

Key env vars: `K6_BASE_URL`, `K6_ENV`, `K6_COORDINATOR_EMAIL`, `K6_COORDINATOR_PASSWORD`, `K6_WORKER_EMAIL`, `K6_WORKER_PASSWORD`.

---
