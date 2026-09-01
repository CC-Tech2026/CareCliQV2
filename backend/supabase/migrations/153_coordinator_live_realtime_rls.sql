-- Coordinator/MD live-shift monitoring: real Supabase Realtime for worker
-- documentation as it's written, instead of the 30s poll on coordinator-live.tsx.
--
-- shift_tasks and shift_visit_notes were locked to service_role-only by
-- 140_enable_missing_tenant_rls.sql (correct at the time - nothing queried them
-- directly). incidents has RLS enabled (004_enable_rls.sql) but was only ever
-- given an INSERT policy - authenticated clients get zero rows today. shifts and
-- alerts already have working org-scoped SELECT policies, they just were never
-- added to the realtime publication.
--
-- New SELECT policies here are deliberately scoped to coordinator/MD
-- (cs_has_org_wide_access), not "any org member" like shifts_org_select already
-- is - incidents in particular must not become directly readable org-wide by
-- support workers via the browser's Supabase client (the backend API restricts
-- support workers to only their own reported incidents; a blanket org-scoped
-- policy here would bypass that).

BEGIN;

CREATE OR REPLACE FUNCTION public.cs_has_org_wide_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cs_user_role() IN ('support_coordinator', 'managing_director');
$$;

-- ── shift_tasks: add a coordinator/MD SELECT policy alongside the existing
--    service_role_all deny-by-default policy from 140 ──────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_tasks' AND policyname = 'shift_tasks_select_org_wide'
    ) THEN
        CREATE POLICY shift_tasks_select_org_wide ON public.shift_tasks
        FOR SELECT TO authenticated
        USING (
            organization_id = public.cs_user_org_id()
            AND public.cs_has_org_wide_access()
        );
    END IF;
END $$;

-- ── shift_visit_notes: same treatment ───────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_visit_notes' AND policyname = 'shift_visit_notes_select_org_wide'
    ) THEN
        CREATE POLICY shift_visit_notes_select_org_wide ON public.shift_visit_notes
        FOR SELECT TO authenticated
        USING (
            organization_id = public.cs_user_org_id()
            AND public.cs_has_org_wide_access()
        );
    END IF;
END $$;

-- ── incidents: first-ever SELECT policy for this table ──────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'incidents' AND policyname = 'incidents_select_org_wide'
    ) THEN
        CREATE POLICY incidents_select_org_wide ON public.incidents
        FOR SELECT TO authenticated
        USING (
            organization_id = public.cs_user_org_id()
            AND public.cs_has_org_wide_access()
        );
    END IF;
END $$;

-- ── Realtime publication ─────────────────────────────────────────────────────
ALTER TABLE public.shifts REPLICA IDENTITY FULL;
ALTER TABLE public.shift_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.shift_visit_notes REPLICA IDENTITY FULL;
ALTER TABLE public.alerts REPLICA IDENTITY FULL;
ALTER TABLE public.incidents REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shifts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shift_tasks'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_tasks;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shift_visit_notes'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_visit_notes;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alerts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'incidents'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
    END IF;
END $$;

COMMIT;
