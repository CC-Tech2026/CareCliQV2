-- ============================================================
-- Lock down what the browser's Supabase key can reach
-- ============================================================
-- The anon key is published in the web app on purpose (it lets the
-- browser open Supabase Realtime), so Postgres grants and RLS are the
-- only thing between that key and the data. A security review on
-- 2026-11-24 found three policies that were added by hand in the
-- dashboard (none of them is in a migration) and left data open:
--
--   alerts        anon_read_alerts                     anyone with the
--                 anon key could read every alert, in every organisation
--   participants  allow_authenticated_read_participants  any signed-in
--                 user could read every participant, in every organisation
--   invitations   authenticated_can_view_invitations     any signed-in
--                 user could read every invitation token
--
-- The web app reads tables directly only for Realtime, on the eight
-- tables granted below (hooks useCoordinatorLiveRealtime,
-- useNotificationRealtime, useWorkerNotificationPresenter). The mobile
-- app never talks to Supabase directly, and the API uses the service
-- role (or Quill's own quill_agent role, untouched here). So the anon
-- and authenticated roles need no writes at all and only those eight
-- reads. This migration takes everything else away, which also closes
-- any other over-broad policy, past or future, for those two roles.
--
-- Adding a Realtime subscription on another table now needs a GRANT
-- SELECT to authenticated plus an RLS policy for it, in a migration;
-- test_browser_table_access.py fails until the grant is listed here.
--
-- Safe to run more than once.

-- 1. The three hand-made policies, and direct writes nobody uses.
DROP POLICY IF EXISTS anon_read_alerts ON public.alerts;
DROP POLICY IF EXISTS alerts_insert_org ON public.alerts;
DROP POLICY IF EXISTS allow_authenticated_read_participants ON public.participants;
DROP POLICY IF EXISTS authenticated_can_view_invitations ON public.invitations;
-- Let any member of an organisation read, create and edit its
-- invitations (including the role and token) straight through the
-- anon key: a worker could invite themselves as a director. The API
-- handles invitations with the service role.
DROP POLICY IF EXISTS invitations_org ON public.invitations;

-- 2. No table, view or sequence in public for anon; reads only for
--    signed-in users, and only on the Realtime tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT SELECT ON
    public.shifts,
    public.shift_tasks,
    public.shift_visit_notes,
    public.alerts,
    public.incidents,
    public.conversations,
    public.conversation_messages,
    public.user_notifications
TO authenticated;

-- New tables and sequences made by migrations (which run as postgres)
-- start closed to both roles instead of open.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 3. Realtime policies for the granted tables.
-- alerts had no read policy for signed-in users at all (only the open
-- anon one), so coordinators' live alerts relied on the leak. Office
-- staff see their organisation's alerts; anyone sees alerts sent to them.
DROP POLICY IF EXISTS alerts_select_own_or_org_wide ON public.alerts;
CREATE POLICY alerts_select_own_or_org_wide ON public.alerts
    FOR SELECT TO authenticated
    USING (
        recipient_user_id = (SELECT auth.uid())
        OR (organization_id = (SELECT public.cs_user_org_id())
            AND (SELECT public.cs_has_org_wide_access()))
    );

-- shifts: every member of the organisation, including Participants
-- Portal logins, could stream every shift. Only the coordinator live
-- board subscribes, so: office staff for the organisation, or the
-- worker on the shift.
DROP POLICY IF EXISTS shifts_org_select ON public.shifts;
CREATE POLICY shifts_org_select ON public.shifts
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.cs_user_org_id())
        AND ((SELECT public.cs_has_org_wide_access())
             OR worker_id = (SELECT auth.uid()))
    );

-- 4. Two SECURITY DEFINER functions write rows for any organisation id
--    they are given; anyone with the anon key could call them through
--    /rest/v1/rpc. Only the API (service role) and triggers use them.
REVOKE EXECUTE ON FUNCTION public.ensure_head_office(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_employee_seq(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_head_office(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_employee_seq(uuid, text) TO service_role;

-- 5. The migration ledger is the one public table without RLS on some
--    databases. Nothing but the service role needs it.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
