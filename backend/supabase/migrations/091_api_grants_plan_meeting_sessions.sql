-- Migration 091: Explicit API grants for plan_meeting_sessions
-- Purpose: Ensure Data API roles can access the table (RLS still enforces row access)

BEGIN;

-- Authenticated users can perform CRUD (RLS policies decide which rows)
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.plan_meeting_sessions
TO authenticated;

-- Service role has full access and bypasses RLS (server-side only)
GRANT ALL
ON TABLE public.plan_meeting_sessions
TO service_role;

COMMIT;
