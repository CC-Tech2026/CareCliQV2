# Real-Postgres RLS integration suite

Everything else in `backend/tests/` mocks the Supabase client and never
executes real SQL — which is exactly why the RLS bugs found in the
2026-08-21 tenant isolation audit (`FORCE ROW LEVEL SECURITY` run without ever
running `ENABLE`, and ~30 tenant-scoped tables that never had RLS enabled at
all) were invisible to it. This suite applies the actual migration SQL to a
real, disposable Postgres container and queries it as the real `authenticated`
Postgres role, so it proves enforcement rather than intent.

## Running it

Requires Docker running locally.

```
INTEGRATION_REAL_DB=1 pytest backend/tests/integration/ -v
```

Without `INTEGRATION_REAL_DB=1` the whole suite skips (including in the
regular `pytest backend/tests/` run and in `ci-isolation.yml`) — it is not
part of the default suite.

The suite starts a throwaway `postgres:16` container (`ccq_rls_integration_test`,
port 55433 by default — override with `CCQ_TEST_PG_PORT`), builds a minimal
schema (only the tables the fix migrations under test actually touch, with a
hand-written `auth.uid()` shim matching Supabase's real implementation), and
stops the container when the session ends.

## Why it doesn't replay the full migration history

It deliberately does **not** run `backend/supabase/migrations/*.sql` in full
historical order. Doing so hits pre-existing issues unrelated to tenant
isolation:

- `073_task_pricing_evidence_invoicing.sql` runs `DROP VIEW IF EXISTS
  public.task_instances`, but `068_task_management_system.sql` created
  `task_instances` as a **table**, not a view — `DROP VIEW` on a table errors
  in real Postgres regardless of `IF EXISTS`. Worth a look separately; this
  audit's fix (140) is written to be correct either way (see its comments).
- `053_system_notifications.sql` has `user_notifications.organization_id
  REFERENCES public.organizations(organization_id)`, but `organizations`'
  actual primary key column (from `001_core_tables.sql`) is `id`, not
  `organization_id`.

Neither is a tenant-isolation bug, so fixing them was out of scope here.
Instead, `conftest.py` builds minimal tables with exactly the columns the real
policies reference, then applies `054_notifications_realtime_rls.sql`,
`139_fix_realtime_rls_enable.sql`, and `140_enable_missing_tenant_rls.sql`
verbatim — the policy logic under test is the real production SQL, not a
reimplementation of it.

## What's covered vs. what isn't

Covered: the exact FORCE-vs-ENABLE bug and its fix (139), and the
never-enabled-RLS bug and its deny-by-default fix (140), including a live
cross-user read demonstrating the bug and its resolution.

Not covered: the other ~140 migrations, storage bucket policies, and
`org`-scoped (as opposed to deny-by-default) policies — none of those were
touched by this audit's fixes. A natural follow-up is wiring a version of this
suite into `ci-isolation.yml` as a `services:` container so it runs on every
migration change automatically; that needs CI credentials/secrets setup this
session didn't have access to configure.
