---
name: CareScribe architecture & migration decisions
description: Cross-service auth/routing/AI decisions for the CareScribe NDIS app — read before "fixing" auth, the gateway, or AI provider wiring.
---

# Supabase is intentional — do NOT migrate to Replit Auth/DB
The app keeps **Supabase** for both auth and primary data. This is a deliberate
decision, not an oversight.
**Why:** It is a mature, multi-tenant clinical app with deep Supabase usage (RLS,
org scoping, dozens of services). Swapping to Replit Auth/Postgres would be a full
rewrite, which the migration's no-rewrite constraint forbids.
**How to apply:** Supabase creds live in secrets: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (read server-side only, in the
Python backend `backend/app/core/config.py`). If they go missing, request them;
do not replace Supabase.

# Three workflows / gateway routing
- **Python Backend** (FastAPI) on :8000 — the real app (auth, participants,
  sessions, AI, etc.). Routes are `/api/participants` (NOT `/api/patients`), etc.
- **API Server** (Node/Express) on :8080 — a thin gateway. Proxies ALL `/api/*`
  to the Python backend EXCEPT local routes it serves itself from **Replit
  Postgres** (Drizzle): `/api/settings*` and `/api/healthz`.
- **Frontend** (Vite/React) on :5000 — dev proxy targets :8080 (the gateway),
  not :8000 directly.
**Why:** Frontend must go through the gateway so the local Replit-DB routes and
the proxied Python routes share one origin.

# Auth token model (shared HS256 JWT, not Supabase's JWT)
The backend mints its **own** HS256 JWT signed with `SESSION_SECRET`
(`backend/app/core/security.py`), payload has `sub` = user id. Frontend stores it
in localStorage (`carescribe_token`) and sends `Authorization: Bearer`.
**How to apply:** Any gateway route the Express server serves locally must verify
this same token with `SESSION_SECRET` (HS256) and scope data by `sub`. See
`artifacts/api-server/src/lib/auth.ts` (dependency-free verifier). The
`/api/settings/practitioner` rows are keyed by user id in the `practitioner_settings`
table (`id` column holds the user id).

# AI providers via Replit AI Integrations (with key fallback)
`backend/app/services/ai_service.py` builds OpenAI + Anthropic clients preferring
Replit AI Integrations env vars (`AI_INTEGRATIONS_OPENAI_BASE_URL`/`_API_KEY`,
`AI_INTEGRATIONS_ANTHROPIC_*`) and falls back to direct `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY`. The app already uses `gpt-4o-mini` (legacy but allowed since
pre-existing). `_openai_configured()` gates the translation path.

# Known external gap (not a migration bug)
The user's Supabase project is missing the `organizations` table (startup logs:
"organizations table missing — run backend/supabase_patch_missing_tables.sql"
plus a 400 on that table). Non-fatal; it's their DB schema, fixable by running
that patch SQL in Supabase. Not an app/migration defect.

# Monorepo typecheck caveat
`pnpm --filter @workspace/api-server run typecheck` fails with TS6305 because the
workspace lib packages (`@workspace/db`, `@workspace/api-zod`) aren't prebuilt to
`dist`. This is pre-existing project-references config, NOT a code error. The dev
build uses esbuild (bundles from source) and runs fine — don't chase the tsc
errors as if they were regressions.
