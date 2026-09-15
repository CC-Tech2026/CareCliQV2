-- ============================================================
-- Quill chatbox — dedicated read-only Postgres role
--
-- Until now every Quill tool ran on the service-role key, which bypasses
-- RLS entirely, so the Python scope checks in
-- app/services/chatbox/tools.py were the *only* boundary between the LLM
-- and the database. This migration adds a database-level backstop:
--
--   * quill_agent   — a NOLOGIN role PostgREST can switch to when it
--                     receives a JWT whose "role" claim is "quill_agent".
--                     The backend mints those tokens per request
--                     (app/services/chatbox/db.py) and signs them with
--                     SUPABASE_JWT_SECRET.
--   * GRANTs        — SELECT only, and only on the tables Quill's direct
--                     queries touch. No INSERT/UPDATE/DELETE anywhere.
--                     users is column-restricted so email, onboarding_data,
--                     deactivation_* etc. never reach the Python process.
--   * RLS policies  — every granted table is filtered to the organisation
--                     carried in the token's "org_id" claim, so a tool that
--                     forgets its org filter still gets only its own org.
--
-- Scope (step 1): the seven direct get_supabase_admin() call sites that
-- were in tools.py — shifts, users, organization_members. Helpers Quill
-- borrows from incident_service / rag_service / dashboards still run on
-- the service role and will be moved over when they accept an injected
-- client. Team-level (coordinator) scoping stays in Python for now; this
-- layer enforces the org boundary only.
-- ============================================================

-- ── Role ────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quill_agent') THEN
        CREATE ROLE quill_agent NOLOGIN NOINHERIT;
    END IF;
END $$;

-- PostgREST connects as `authenticator` and SET ROLEs to the JWT's role
-- claim; it can only do that for roles it has been granted.
GRANT quill_agent TO authenticator;
GRANT USAGE ON SCHEMA public TO quill_agent;

-- ── JWT claim helper ────────────────────────────────────────────────────
-- PostgREST exposes every JWT claim via request.jwt.claims. Returns NULL
-- (→ zero rows under RLS) if the claim is absent or malformed, so a token
-- without an org can never widen access.

CREATE OR REPLACE FUNCTION public.quill_jwt_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(
        current_setting('request.jwt.claims', true)::jsonb ->> 'org_id',
        ''
    )::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.quill_jwt_org_id() TO quill_agent;

-- ── Table grants (read-only) ────────────────────────────────────────────

-- shifts: get_shift_coverage, get_session_activity, and the four export
-- tools read the full shift row (via _execute_shift_query_with_legacy_fallback).
GRANT SELECT ON public.shifts TO quill_agent;

-- organization_members: get_retention_rate counts active/inactive members.
GRANT SELECT (id, user_id, organization_id, role, is_active)
    ON public.organization_members TO quill_agent;

-- users: get_coordinator_team_ids() resolves a coordinator's linked workers.
-- Deliberately excludes email, onboarding_data, deactivation_*, last_login.
-- Postgres requires SELECT on every column referenced in a WHERE clause,
-- which is why role/coordinator_id/organization_id are here even though
-- the helper only selects `id`.
GRANT SELECT (id, full_name, role, coordinator_id, organization_id, is_active)
    ON public.users TO quill_agent;

-- ── RLS policies — org boundary from the token ──────────────────────────
-- Each table already has RLS enabled (029_shifts.sql, supabase_setup.sql).
-- Policies are per-role, so these sit alongside the existing
-- authenticated/service_role policies without touching them.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shifts' AND policyname = 'quill_agent_org_select'
    ) THEN
        CREATE POLICY quill_agent_org_select ON public.shifts
            FOR SELECT TO quill_agent
            USING (organization_id = public.quill_jwt_org_id());
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'organization_members' AND policyname = 'quill_agent_org_select'
    ) THEN
        CREATE POLICY quill_agent_org_select ON public.organization_members
            FOR SELECT TO quill_agent
            USING (organization_id = public.quill_jwt_org_id());
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'users' AND policyname = 'quill_agent_org_select'
    ) THEN
        CREATE POLICY quill_agent_org_select ON public.users
            FOR SELECT TO quill_agent
            USING (organization_id = public.quill_jwt_org_id());
    END IF;
END $$;

-- ── Verification (run by hand in the SQL editor after applying) ─────────
--
--   BEGIN;
--   SET LOCAL ROLE quill_agent;
--   SELECT set_config('request.jwt.claims',
--       '{"role":"quill_agent","org_id":"<an org uuid>"}', true);
--   SELECT count(*) FROM public.shifts;             -- only that org's rows
--   SELECT email FROM public.users LIMIT 1;         -- ERROR: permission denied for table users
--   SELECT count(*) FROM public.chatbox_messages;   -- ERROR: permission denied
--   DELETE FROM public.shifts WHERE false;          -- ERROR: permission denied
--   ROLLBACK;
