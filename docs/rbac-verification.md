# RBAC Verification

## Roles

- `support_coordinator`: organisation-wide access, team management, invitations, assignments.
- `admin`: legacy coordinator-equivalent.
- `support_worker`: assigned participant access only.
- `allied_health`: assigned clinical caseload access only.
- Unknown roles: fail closed.

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

## Manual Checks

1. Unauthenticated protected API calls should return `401`.
2. A worker or allied health token without an active `practitioner_allocations` row should receive no participant/session/incident rows.
3. Direct ID access for an unassigned participant/session/incident should return `403`.
4. Coordinator/admin access is restricted to matching `organization_id`.
5. Team management and invitations should return `403` for non-coordinators.

## Commands

```powershell
python -m unittest backend.tests.test_rbac
corepack pnpm --filter @workspace/api-server run build
corepack pnpm --filter @workspace/frontend run build
```

## Deferred Verification

Full end-to-end Supabase API tests require configured `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a disposable Supabase project or local Supabase stack. The migration file is idempotent and non-destructive, but it should be applied in staging before production.
