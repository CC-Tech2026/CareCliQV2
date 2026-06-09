-- ============================================================
-- CCQ-102 — Complete RLS for all organisation-scoped tables
-- ============================================================
-- Ensures RLS is enabled (FORCE) on every org-scoped table and
-- covers SELECT / INSERT / UPDATE / DELETE with org-isolation
-- policies.  Duplicate policy names are guarded by IF NOT EXISTS
-- checks so this file is idempotent.
--
-- Policy convention:
--   SELECT  → USING  (organization_id = cs_user_org_id())
--   INSERT  → WITH CHECK (organization_id = cs_user_org_id())
--   UPDATE  → USING + WITH CHECK
--   DELETE  → USING
--   service_role always bypasses RLS (Supabase default).
-- ============================================================

BEGIN;

-- ── 0. Ensure cs_user_org_id() helper exists ────────────────────────────────

CREATE OR REPLACE FUNCTION public.cs_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM   public.organization_members
  WHERE  user_id   = auth.uid()
    AND  is_active = true
  LIMIT 1;
$$;

-- ── 1. Core tables — patients, sessions, incidents, alerts ──────────────────

ALTER TABLE public.patients  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sessions  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.alerts    FORCE ROW LEVEL SECURITY;

-- patients INSERT guard
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='patients_insert_org') THEN
        CREATE POLICY patients_insert_org ON public.patients FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- sessions INSERT guard
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='sessions_insert_org') THEN
        CREATE POLICY sessions_insert_org ON public.sessions FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- incidents INSERT guard
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='incidents' AND policyname='incidents_insert_org') THEN
        CREATE POLICY incidents_insert_org ON public.incidents FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- alerts INSERT guard
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alerts' AND policyname='alerts_insert_org') THEN
        CREATE POLICY alerts_insert_org ON public.alerts FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- ── 2. ndis_plans — already RLS-enabled; add missing policies ───────────────

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_select_org') THEN
        CREATE POLICY ndis_plans_select_org ON public.ndis_plans FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_insert_org') THEN
        CREATE POLICY ndis_plans_insert_org ON public.ndis_plans FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_update_org') THEN
        CREATE POLICY ndis_plans_update_org ON public.ndis_plans FOR UPDATE TO authenticated
        USING (organization_id = public.cs_user_org_id())
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_delete_org') THEN
        CREATE POLICY ndis_plans_delete_org ON public.ndis_plans FOR DELETE TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- ── 3. plan_budgets / budget_usage / patient_goals — scoped via plan_id ─────

ALTER TABLE public.plan_budgets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_usage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_goals  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plan_budgets' AND policyname='plan_budgets_org') THEN
        CREATE POLICY plan_budgets_org ON public.plan_budgets FOR ALL TO authenticated
        USING (
            plan_id IN (SELECT id FROM public.ndis_plans WHERE organization_id = public.cs_user_org_id())
        )
        WITH CHECK (
            plan_id IN (SELECT id FROM public.ndis_plans WHERE organization_id = public.cs_user_org_id())
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='budget_usage' AND policyname='budget_usage_org') THEN
        CREATE POLICY budget_usage_org ON public.budget_usage FOR ALL TO authenticated
        USING (
            plan_id IN (SELECT id FROM public.ndis_plans WHERE organization_id = public.cs_user_org_id())
        )
        WITH CHECK (
            plan_id IN (SELECT id FROM public.ndis_plans WHERE organization_id = public.cs_user_org_id())
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patient_goals' AND policyname='patient_goals_org') THEN
        CREATE POLICY patient_goals_org ON public.patient_goals FOR ALL TO authenticated
        USING (
            plan_id IN (SELECT id FROM public.ndis_plans WHERE organization_id = public.cs_user_org_id())
        )
        WITH CHECK (
            plan_id IN (SELECT id FROM public.ndis_plans WHERE organization_id = public.cs_user_org_id())
        );
    END IF;
END $$;

-- ── 4. session_messages — scoped via session_id ─────────────────────────────

ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='session_messages' AND policyname='session_messages_org') THEN
        CREATE POLICY session_messages_org ON public.session_messages FOR ALL TO authenticated
        USING (
            session_id IN (SELECT id FROM public.sessions WHERE organization_id = public.cs_user_org_id())
        )
        WITH CHECK (
            session_id IN (SELECT id FROM public.sessions WHERE organization_id = public.cs_user_org_id())
        );
    END IF;
END $$;

-- ── 5. practitioner_allocations ──────────────────────────────────────────────

ALTER TABLE public.practitioner_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_allocations' AND policyname='practitioner_allocations_org') THEN
        CREATE POLICY practitioner_allocations_org ON public.practitioner_allocations FOR ALL TO authenticated
        USING (organization_id = public.cs_user_org_id())
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- ── 6. invitations — org scoped (coordinator only enforced at API layer) ─────

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invitations' AND policyname='invitations_org') THEN
        CREATE POLICY invitations_org ON public.invitations FOR ALL TO authenticated
        USING (organization_id = public.cs_user_org_id())
        WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- ── 7. organization_members — a user can see their own org's members ─────────

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='org_members_select') THEN
        CREATE POLICY org_members_select ON public.organization_members FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- Insert/Update/Delete on org_members is service-role only (admin operations)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='org_members_service_role') THEN
        CREATE POLICY org_members_service_role ON public.organization_members FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

-- ── 8. audit_logs / access_logs — write-only by authenticated, read by own org ──

ALTER TABLE public.audit_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_logs_org_select') THEN
        CREATE POLICY audit_logs_org_select ON public.audit_logs FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_logs_org_insert') THEN
        CREATE POLICY audit_logs_org_insert ON public.audit_logs FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id() OR organization_id IS NULL);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='access_logs' AND policyname='access_logs_org_select') THEN
        CREATE POLICY access_logs_org_select ON public.access_logs FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='access_logs' AND policyname='access_logs_org_insert') THEN
        CREATE POLICY access_logs_org_insert ON public.access_logs FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.cs_user_org_id() OR organization_id IS NULL);
    END IF;
END $$;

-- ── 9. credentials / report_history / toolkit_* / invoices ──────────────────
--    These tables already have RLS enabled (from 012_sprint_feature_rls_hardening).
--    We add authenticated user policies on top of the existing service_role bypass.

ALTER TABLE IF EXISTS public.credentials         FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.report_history      FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.toolkit_items       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.toolkit_movements   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.restock_requests    FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.invoices            ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='credentials' AND column_name='organization_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credentials' AND policyname='credentials_org') THEN
            CREATE POLICY credentials_org ON public.credentials FOR ALL TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
        END IF;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='report_history' AND column_name='organization_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='report_history' AND policyname='report_history_org') THEN
            CREATE POLICY report_history_org ON public.report_history FOR ALL TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
        END IF;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='toolkit_items' AND column_name='organization_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='toolkit_items' AND policyname='toolkit_items_org') THEN
            CREATE POLICY toolkit_items_org ON public.toolkit_items FOR ALL TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
        END IF;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='toolkit_movements' AND column_name='organization_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='toolkit_movements' AND policyname='toolkit_movements_org') THEN
            CREATE POLICY toolkit_movements_org ON public.toolkit_movements FOR ALL TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
        END IF;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='organization_id') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoices' AND policyname='invoices_org') THEN
            CREATE POLICY invoices_org ON public.invoices FOR ALL TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
        END IF;
    END IF;
END $$;

COMMIT;
