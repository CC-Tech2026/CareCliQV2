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
- Routes under `/api/participants`, `/api/sessions`, `/api/alerts`, `/api/compliance`, `/api/ai`, `/api/reports`, `/api/budget` are proxied to the Python backend (port 8000)
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

### Live Clinical Session (`/sessions/:id/live`)
- Full-screen mobile-first interface, no sidebar (dedicated session mode)
- **Live timer** (HH:MM:SS, mono font) with animated pulse indicator
- **Control bar**: Start Session / End Session buttons (green/red) with colour-coded dark header (indigo when active)
- **Translation mode toggle** (top-right) — adds EN translation markers to voice notes and clinical notes
- **4 tabs**: Activities · Notes · Goals · Evidence
  - **Activities**: Quick-Add grid (8 colour-coded NDIS activity types with emoji); tap to log with timestamp; activity log list below
  - **Notes**: Web Speech API voice recording; real-time transcription preview; timestamped note cards; graceful fallback for unsupported browsers
  - **Goals**: List of session goals from participant record (or 3 defaults); tap to cycle status: Not Started → In Progress → Achieved → Needs Review
  - **Evidence**: Photo capture via file input with `capture="environment"`; thumbnail grid with timestamp overlay; remove individual photos
- **Bottom quick-action bar** (fixed): Activity / Voice Note (mic, large center button) / Photo / Goal
- **End Session → Auto-Summary Modal**: compliance score heuristic, clinical notes paragraph, activities logged, goal progress, evidence count, voice note count; "View Full Session" or "Done" actions
- Also calls `POST /api/sessions/:id/save-with-ai` in background after ending session
- **Entry points**: "Start Live" button on each session card in Sessions list; "Start Live" button in session detail header

### Compliance Centre (`/compliance`)
- **Gauge** showing overall NDIS audit score (SVG arc, colour-coded)
- **Status cards**: Compliant (≥85%), At Risk (60-84%), Non-Compliant (<60%) session counts
- **Most Common Issues**: Aggregated failing rules across all sessions with relative frequency bars
- **Budget Impact**: Estimated at-risk revenue from non-compliant sessions + overall claim rate
- **Session Audit Log**: Filterable table with status filter tabs (All/Compliant/At Risk/Non-Compliant/Draft), compliance score bar, rules check icons, Review link
- New backend endpoints: `GET /api/reports/compliance-overview`, `POST /api/compliance/run/{id}`

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
> **Note**: Run the new section of `backend/supabase_setup.sql` in Supabase SQL editor to create these tables and add the new columns (`compliance_status`, `cost`, `support_category` on sessions; `ndis_plan_id` on patients).

### Important: Supabase FK Join Workaround
PostgREST's relational join syntax (e.g. `patients(full_name)`) requires a registered FK in the schema cache. Because this can be unreliable, **all session service queries use a two-query approach**: fetch sessions first, then batch-fetch patient names by ID. Do not add PostgREST join syntax back to `session_service.py`.

### Session Detail (`/sessions/:id`) — Claim Readiness Centre
- **Claim Readiness Badge**: Compliant / At Risk / Non-Compliant / Draft derived from score (≥85 / 60-84 / <60 / null)
- **Live Compliance Warning Bar**: Real-time local rules check as you type notes — shows errors (blocking) and warnings (advisory) with character count feedback
- **Blocking Save Dialog**: AlertDialog modal when critical issues detected before saving notes — user can "Fix First" or "Save Draft Anyway"
- **Rules Breakdown Panel**: Pass/warn/fail icons per rule after AI analysis (from `rules_result` in `ai_insights` JSON)
- **AI Fix Suggestions**: On-demand fetch from `POST /ai/explain-compliance` — shows explanation + how-to-fix for failed rules
- **Re-check Button**: Calls `POST /compliance/run/:id` to re-run compliance engine without full AI analysis
- **Cost/Billing Card**: Shows `support_category` and `cost` columns if set on session
- **Upgraded AI Insights Panel**: Summary, key observations, next session recommendations, progress trend

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
