# AI Clinical Companion for NDIS Providers

A full-stack clinical management system for solo NDIS (National Disability Insurance Scheme) support providers in Australia.

## Architecture

- **Frontend**: React + TypeScript + Tailwind + shadcn/ui (`artifacts/frontend/`)
- **Backend**: Python FastAPI (`backend/`)
- **Database**: Supabase PostgreSQL (external)
- **AI**: OpenAI GPT-4o-mini for summaries, clinical insights, compliance checking

## Running the App

- **Python Backend**: Runs via "Python Backend" workflow on port 8000
- **API Server (Node/Express)**: Runs via "artifacts/api-server: API Server" workflow on port 8080
- **Frontend**: Runs via "artifacts/frontend: web" workflow on port 18130

### Request Routing

The Replit preview proxy (`localhost:80`) routes to the `api-server` (port 8080) for API calls. The `api-server` acts as a reverse proxy:
- Routes under `/api/participants`, `/api/sessions`, `/api/alerts`, `/api/compliance`, `/api/ai` are proxied to the Python backend (port 8000)
- The Express proxy middleware runs **before** body-parsing middleware so POST/PATCH request bodies are correctly forwarded

The frontend Vite dev server (port 18130) also proxies `/api` directly to port 8000 for local development.

## Features

### Dashboard (`/dashboard`)
- 4 stat cards: Active Participants, Sessions This Week, Missing Notes, Compliance Alerts
- Recent sessions panel
- Unread alerts / action required panel

### Participants (`/patients`)
- Split-pane layout: list on left, tabbed detail view on right
- Search + filter by plan status
- **Overview tab**: AI summary, plan details, clinical profile, goals, recent sessions
- **NDIS Plan tab**: Full plan overview, budget by support category (Core/Capacity Building/Capital), budget alerts, goals
- **Client History tab**: Full session history with search, compliance scores, session status
- Add participant modal + Edit participant modal (PATCH endpoint)
- Set Up NDIS Plan dialog (creates ndis_plans + plan_budgets records)

### Backend Compliance Engine (`backend/app/services/compliance_engine.py`)
8 rules-based checks on every session: duration present, notes not empty, goals linked, service type set, outcome described, within plan dates, no duplicate timestamps, budget not exceeded. Score = (passed + warnings×0.5) / total × 100. Blended 70/30 with AI compliance score.

### NDIS Funding Tracker (`backend/app/services/funding_service.py`)
- Manages `ndis_plans`, `plan_budgets`, `budget_usage`, `compliance_audit_logs` tables
- Session cost calculated from duration × hourly_rate (mapped from NDIS support item catalog)
- Budget usage recorded per session; plan budget `used_amount` updated in real time
- Compliance audit log stored after every "Save with AI" call

### New Database Tables (`backend/supabase_setup.sql`)
- `ndis_plans` — NDIS plan records per participant
- `plan_budgets` — Budget allocation by support category (core, capacity_building, capital)
- `budget_usage` — Per-session cost records linked to plan budgets
- `support_items` — Simplified NDIS price guide (9 seeded items)
- `compliance_audit_logs` — Rule-by-rule audit trail per session
> **Note**: Run the new section of `backend/supabase_setup.sql` in Supabase SQL editor to create these tables.

### Sessions (`/sessions`, `/sessions/new`, `/sessions/:id`)
- Session list with search + filter by status
- New session form with: participant, date, duration, session type, tags, notes, goals
- Session detail with AI insights panel and compliance score
- "Save with AI" runs compliance check + generates clinical insights via OpenAI

### Compliance (`/compliance`)
- Overall compliance score (circular indicator)
- Per-session audit log table
- NDIS audit readiness info

## Backend Structure

```
backend/
  app/
    core/           # config, security
    models/         # Pydantic models
    schemas/        # Request/response schemas
    services/       # Business logic (supabase_client, ai_service, participant_service, session_service, alert_service)
    api/            # FastAPI routers (participants, sessions, alerts, plans, ai, reports)
    main.py         # App entry point
```

## Database (Supabase)

**Existing tables** (in the user's Supabase project):
- `patients` — NDIS participants with plan details, budget, goals
- `sessions` — Clinical sessions with notes, compliance scores, AI insights
- `plans` — NDIS support plans
- `alerts` — Compliance and plan alerts

**IMPORTANT**: Before using the app with real data, run `backend/supabase_setup.sql` in your Supabase SQL editor:
1. Go to https://supabase.com/dashboard/project/_/sql/new
2. Paste the contents of `backend/supabase_setup.sql`
3. Click "Run"

This will add missing columns to existing tables and create the `alerts` table.

## API Structure

All backend routes are prefixed with `/api`:
- `GET /api/participants` — list all participants
- `POST /api/participants` — create participant
- `GET /api/participants/{id}` — get participant
- `PATCH /api/participants/{id}` — update participant
- `GET /api/participants/dashboard-stats` — dashboard statistics
- `GET /api/sessions` — list all sessions
- `POST /api/sessions` — create session
- `GET /api/sessions/recent` — recent sessions
- `GET /api/sessions/compliance-report` — compliance report
- `GET /api/sessions/{id}` — get session
- `PATCH /api/sessions/{id}` — update session
- `POST /api/sessions/{id}/save-with-ai` — run AI analysis
- `GET /api/alerts` — list alerts
- `POST /api/alerts/{id}/read` — mark alert read
- `POST /api/alerts/read-all` — mark all read
- `GET /api/ai/summary/{participant_id}` — AI participant summary
- `GET /api/ai/compliance-overview` — compliance overview

## Environment Variables (Secrets)

All secrets are configured in Replit:
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (backend uses this)
- `OPENAI_API_KEY` — OpenAI API key for AI features
- `SESSION_SECRET` — Express session secret (for API server)

## Generated API Client

OpenAPI spec: `lib/api-spec/openapi.yaml`
Generated React Query hooks: `lib/api-client-react/src/generated/api.ts`

To regenerate hooks after API spec changes:
```bash
pnpm --filter @workspace/api-client-react run generate
```
