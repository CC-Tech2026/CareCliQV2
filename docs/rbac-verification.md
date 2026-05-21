# RBAC Verification

## Roles

- `support_coordinator`: organisation-wide access, team management, invitations, assignments.
- `admin`: legacy coordinator-equivalent.
- `support_worker`: assigned participant access only.
- `allied_health`: assigned clinical caseload access only.
- Unknown roles: fail closed.

## Auth Alignment

Production auth is Supabase/Python by policy:

- Set `AUTH_BACKEND=python` on the Node API proxy, with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- `/api/auth/*`, invitations, assignments, participants, sessions, incidents, compliance, and reports are then enforced by the Python backend and Supabase-backed tables.
- Login/invite-created users are written to `public.users`; organisation access is written to `public.organization_members`; scoped access is written to `public.practitioner_allocations`.
- JWTs are HS256 with `SESSION_SECRET` and include `sub`, `email`, `role`, `account_type`, and `organization_id`. The Python RBAC layer requires those claims and fails closed for unknown roles.

Local Docker/Replit development uses `AUTH_BACKEND=local` by default when Supabase env vars are absent. That mode stores demo auth in local Postgres tables and issues the same JWT claim shape so the frontend can be exercised without Supabase secrets.

## Test Users

Local Docker demo account:

- `sarah@sunshine-demo.com`
- role: `support_coordinator`
- organisation: `Sunshine Demo Care`

Automated RBAC unit tests use synthetic JWT payloads and patched Supabase query responses. They do not use mock UI screens or seeded-only proof; they exercise the backend RBAC helpers that protect service-role data access.

## Endpoints Covered By This Pass

- `GET /api/participants`
- `POST /api/participants`
- `GET /api/participants/{id}`
- `PUT/PATCH/DELETE /api/participants/{id}`
- participant goals, plan, budget summary, and allocation subroutes
- `GET /api/sessions`
- `GET /api/sessions/recent`
- `GET /api/sessions/participant/{participant_id}`
- `GET/PATCH /api/sessions/{session_id}`
- session context, compliance, audit, upload, transcription, messages, and save-with-AI subroutes
- `GET /api/incidents`
- `GET /api/incidents/{incident_id}`
- `GET /api/incidents/participant/{participant_id}`
- `POST/PATCH /api/incidents`
- invitation create/list/revoke, team members, role update, and remove-member endpoints
- `GET /api/sessions/compliance-report`
- `GET /api/reports/compliance-overview`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`

## Manual Checks

1. Unauthenticated protected API calls should return `401`.
2. A worker or allied health token without an active `practitioner_allocations` row should receive no participant/session/incident rows.
3. Direct ID access for an unassigned participant/session/incident should return `403`.
4. Coordinator/admin access is restricted to matching `organization_id`.
5. Team management and invitations should return `403` for non-coordinators.

## Commands

```powershell
docker compose run --rm -v ${PWD}:/work -w /work python-backend python -m unittest backend.tests.test_rbac backend.tests.test_rbac_api backend.tests.test_compliance_scope
corepack pnpm --filter @workspace/api-server run build
corepack pnpm --filter @workspace/api-server run typecheck
corepack pnpm --filter @workspace/frontend run build
docker compose up -d --build
```

## Results

- Backend tests: PASS, 10 tests.
- API typecheck: PASS.
- API build: PASS.
- Frontend production build: PASS. Vite reports existing sourcemap/chunk-size warnings, but exits successfully.
- Migration order validation: PASS. Applied `000` through `007` in order to local Docker Postgres with `ON_ERROR_STOP=1`.
- Docker rebuild: PASS. `api`, `frontend`, `python-backend`, and `db` are running.
- Local participant smoke test: PASS.
  - Sarah login returns `support_coordinator` plus `organization_id`.
  - Authenticated `GET /api/participants` returns `200`.
  - Unauthenticated `GET /api/participants` returns `401`.
  - Coordinator create participant returns `201`; cleanup delete succeeds.
- Local password reset request smoke test: PASS. Generic response returned and development reset URL is exposed because `EXPOSE_RESET_LINK=true`.

## Remaining Risks

- Full Supabase email delivery was not exercised locally because no Supabase project/email config is present in Docker.
- For deployment, set `AUTH_BACKEND=python` and real Supabase env vars. Keep `AUTH_BACKEND=local` only for local Docker/Replit demo mode.
- Apply migrations in staging before production; they are non-destructive and were validated for order locally.
