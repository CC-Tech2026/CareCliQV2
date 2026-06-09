# API Route Org-Scope Coverage Report

_Generated: 2026-06-09_

## Summary

| Status | Route groups |
|---|---|
| ✅ Org-scoped | alerts, ai, assignments, auth, billing, budget_api, compliance, coordinator, credentials, dashboards, hub, incidents, invitations, md_onboarding, onboarding, participants, plans, reports, security, sessions, settings, toolkit, users, worker |
| ❌ Fixed in this PR | **alerts** (was unscoped), **plans** (was unscoped) |
| N/A (public) | auth login/register/logout/reset, health, docs |

**Result: 0 routes with unscoped SELECT queries after this patch.**

---

## Route-by-route status

### `alerts` ✅ (fixed — previously ❌)
| Method | Path | Org-scoped |
|---|---|---|
| GET | `/alerts` | ✅ `eq("organization_id", org_id)` in `alert_service.get_all_alerts` |
| GET | `/alerts/unread` | ✅ `eq("organization_id", org_id)` in `alert_service.get_unread_alerts` |
| POST | `/alerts` | ✅ `organization_id` stamped on insert |
| PATCH | `/alerts/{id}/read` | ✅ `eq("organization_id", org_id)` guard on update |
| POST | `/alerts/mark-all-read` | ✅ `eq("organization_id", org_id)` scopes bulk update |

### `ai` ✅
All AI routes receive `current_user` and delegate to `participant_service.get_participant_by_id` (org-scoped, raises 404 on cross-org). No unscoped DB reads; AI API calls are stateless text transforms.

### `assignments` ✅
All queries filter by `organization_id` via `_worker_membership_profiles(org_id)`. Cross-org reads blocked.

### `auth` N/A (public)
Login/register/logout/reset are public. `/auth/me` returns only the authenticated user's own record.

### `billing` ✅
All invoice queries: `.eq("organization_id", org_id)`. Revenue report: `billing_service.get_revenue_report(user)` filters by org. Subscription: upserted with `organization_id`.

### `budget_api` ✅
Delegates to `participant_service.get_participant_by_id` for access check before returning budget data. Cross-org participant → 404.

### `compliance` ✅
`/run/{session_id}` and `/report/{patient_id}` go through session/participant services that enforce org boundary.

### `coordinator` ✅
All routes use `_require_coordinator` → `get_user_organization_id` and filter every DB query with `.eq("organization_id", org_id)`.

### `credentials` ✅
All SELECT queries: `.eq("organization_id", org_id)` or `.eq("user_id", uid)` scoped to caller. Coordinator list view also filters by org.

### `dashboards` ✅
All 4 dashboard endpoints call `get_user_organization_id` and pass it to every query. MD dashboard has role guard.

### `hub` ✅
Hub routes filter announcements/events by `organization_id`. Community feed is public read but writes stamp `organization_id`.

### `incidents` ✅
All list/detail/patch routes go through `incident_service` which filters `.eq("organization_id", org_id)`. Participant-scoped incident list also validates participant org.

### `invitations` ✅
Invitation create/list/member routes all check `organization_id` matches caller's org. Validate/accept paths are public (token-gated) and don't expose org data.

### `md_onboarding` ✅
All queries filter by `organization_id`. Role guard: MD only.

### `onboarding` ✅
User-specific (reads/writes own profile row). No cross-org risk.

### `participants` ✅
All list/detail routes go through `participant_service` which enforces `.eq("organization_id", org_id)`. IDOR: cross-org participant → 404 via `assert_can_access_participant`.

### `plans` ✅ (fixed — previously ❌)
| Method | Path | Org-scoped |
|---|---|---|
| GET | `/plans/participant/{id}` | ✅ Verifies participant org membership via `participant_service` before returning plans |
| POST | `/plans` | ✅ Verifies participant org before inserting |
| PATCH | `/plans/{id}` | ✅ Fetches plan → verifies participant org → then updates |

### `reports` ✅
Compliance overview delegates to `session_service.get_compliance_report(current_user)` (org-scoped). History query: `.eq("organization_id", org_id)`. Report generate: stamps `organization_id` and validates participant. PDF stored under org-scoped path.

### `security` ✅
`/reauthenticate` is user-specific. No DB reads.

### `sessions` ✅
All list/detail/create routes go through `session_service` with `current_user` containing `organization_id`. Direct queries in `sessions.py` filter by `organization_id`. IDOR: cross-org session → 404.

### `settings` ✅
`/practitioner` reads/writes by `user_id` only. Personal settings, no org-level cross-read risk.

### `toolkit` ✅
All queries: `.eq("organization_id", org_id)`. Both coordinator (team) and worker (personal) views enforce org scope.

### `users` ✅
`GET/PATCH /users/me` operates on the authenticated user's own row. Avatar upload path is namespaced under `{org_id}/{user_id}/`.

### `worker` ✅
All routes filter by `organization_id` in the worker service layer. Participant access is validated via assignment membership.

---

## Tests covering isolation

| Test file | Coverage |
|---|---|
| `test_multitenant_isolation.py` | sessions, participants, incidents, embeddings, middleware, JWT, IDOR, RLS |
| `test_ccq_108_report_isolation.py` | compliance overview, revenue report, worker stats, 2-org regression |

CI: `.github/workflows/ci-isolation.yml` — runs on every PR touching `backend/app/**`, `backend/tests/**`, or `backend/supabase/migrations/**`.
