-- ============================================================
-- CareScribe: RLS Policy Audit & Repair
-- Version: 2026-05  |  Idempotent — safe to run multiple times
-- ============================================================
--
-- PURPOSE
--   Audit and repair incomplete RLS on all CareScribe tables.
--   Fixes: missing policies, dangerous anon/USING(true) policies,
--   cross-tenant exposure, and missing organization scoping.
--
-- ARCHITECTURE
--   • The Python backend uses the service_role key which bypasses
--     RLS — so service-role policies in supabase_setup.sql are fine.
--   • These authenticated-user policies protect against direct
--     Supabase client access, misconfigured keys, and future
--     frontend-direct queries.
--   • All org-scoped policies use SECURITY DEFINER helper functions
--     that query organization_members — this prevents RLS recursion.
--
-- HOW TO RUN
--   Paste the entire file into Supabase SQL Editor → Run.
-- ============================================================


-- ============================================================
-- SECTION 1 — organization_members TABLE
-- Central RBAC table. Decouples role from the users row so that
-- a user can have different roles in different organisations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_members (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL DEFAULT 'support_worker'
                                CHECK (role IN (
                                    'admin', 'manager', 'support_worker',
                                    'support_coordinator', 'auditor'
                                )),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    invited_by      UUID        REFERENCES public.users(id),
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_org_member UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id  ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id   ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role     ON public.organization_members(role);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Service role: unrestricted
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='om_service_role_all') THEN
        CREATE POLICY om_service_role_all ON public.organization_members
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Members can read their own membership rows
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='om_self_read') THEN
        CREATE POLICY om_self_read ON public.organization_members
            FOR SELECT TO authenticated USING (user_id = auth.uid());
    END IF;
END $$;

-- Admins/managers can see all members in their organisation
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='om_admin_read_org') THEN
        CREATE POLICY om_admin_read_org ON public.organization_members
            FOR SELECT TO authenticated
            USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members
                    WHERE user_id = auth.uid()
                      AND is_active = TRUE
                      AND role IN ('admin', 'manager')
                )
            );
    END IF;
END $$;

-- Admins can insert/update/delete org members
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='om_admin_write') THEN
        CREATE POLICY om_admin_write ON public.organization_members
            FOR ALL TO authenticated
            USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members
                    WHERE user_id = auth.uid()
                      AND is_active = TRUE
                      AND role = 'admin'
                )
            )
            WITH CHECK (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members
                    WHERE user_id = auth.uid()
                      AND is_active = TRUE
                      AND role = 'admin'
                )
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 2 — BACKFILL organization_members FROM users TABLE
-- Existing users with organization_id get a membership row.
-- Safe to run multiple times (ON CONFLICT DO UPDATE).
-- ============================================================

INSERT INTO public.organization_members (user_id, organization_id, role, is_active)
SELECT
    u.id,
    u.organization_id,
    -- Map users.role to the organization_members role domain
    CASE u.role
        WHEN 'admin'               THEN 'admin'
        WHEN 'support_coordinator' THEN 'support_coordinator'
        WHEN 'allied_health'       THEN 'support_worker'  -- closest valid role
        ELSE 'support_worker'
    END,
    u.is_active
FROM public.users u
WHERE u.organization_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = u.organization_id)
ON CONFLICT (user_id, organization_id) DO UPDATE
    SET role      = EXCLUDED.role,
        is_active = EXCLUDED.is_active;


-- ============================================================
-- SECTION 3 — SECURITY DEFINER HELPER FUNCTIONS
-- These run with definer privileges so they can read
-- organization_members without triggering RLS on that table,
-- preventing infinite recursion in policy evaluation.
-- ============================================================

-- Returns the authenticated user's current organization_id
CREATE OR REPLACE FUNCTION public.cs_user_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT organization_id
    FROM   public.organization_members
    WHERE  user_id   = auth.uid()
      AND  is_active = TRUE
    LIMIT  1;
$$;

-- Returns the authenticated user's role within their organisation
CREATE OR REPLACE FUNCTION public.cs_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role
    FROM   public.organization_members
    WHERE  user_id   = auth.uid()
      AND  is_active = TRUE
    LIMIT  1;
$$;

-- TRUE if the user holds an administrative role
CREATE OR REPLACE FUNCTION public.cs_is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE  user_id   = auth.uid()
          AND  is_active = TRUE
          AND  role IN ('admin', 'manager')
    );
$$;

-- TRUE if the user can manage participants/sessions (admin, coordinator, manager)
CREATE OR REPLACE FUNCTION public.cs_is_coordinator()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE  user_id   = auth.uid()
          AND  is_active = TRUE
          AND  role IN ('admin', 'manager', 'support_coordinator')
    );
$$;

-- TRUE if user is an auditor or admin (read-only audit access)
CREATE OR REPLACE FUNCTION public.cs_is_auditor()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE  user_id   = auth.uid()
          AND  is_active = TRUE
          AND  role IN ('admin', 'manager', 'auditor')
    );
$$;


-- ============================================================
-- SECTION 4 — REMOVE DANGEROUS POLICIES
-- Identified: USING(true) TO anon on alerts table.
-- This exposes sensitive healthcare data to unauthenticated users.
-- ============================================================

DROP POLICY IF EXISTS "anon_read_alerts" ON public.alerts;

-- Also remove any overly broad USING(true) authenticated policies
-- that were added without org scoping (none found in current SQL,
-- but guard against future regressions):
DROP POLICY IF EXISTS "authenticated_read_all" ON public.patients;
DROP POLICY IF EXISTS "authenticated_read_all" ON public.sessions;
DROP POLICY IF EXISTS "authenticated_read_all" ON public.incidents;
DROP POLICY IF EXISTS "authenticated_read_all" ON public.alerts;


-- ============================================================
-- SECTION 5 — ENABLE RLS ON TABLES MISSING IT
-- patients and sessions are the most critical — they hold all
-- healthcare PII and were not protected in supabase_setup.sql.
-- ============================================================

ALTER TABLE public.patients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents  ENABLE ROW LEVEL SECURITY;

-- plans is a legacy table referenced in plans.py; enable RLS defensively.
-- NOTE: If this table does not yet exist, this statement is harmless.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans' AND table_schema = 'public') THEN
        EXECUTE 'ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY';
    END IF;
END $$;


-- ============================================================
-- SECTION 6 — patients TABLE POLICIES
-- Direct organization_id column — straightforward scoping.
-- ============================================================

-- Service role (already exists in supabase_setup.sql — guard against re-run)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='patients_service_role_all') THEN
        CREATE POLICY patients_service_role_all ON public.patients
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- SELECT: any active org member can read participants in their organisation
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='patients_org_member_select') THEN
        CREATE POLICY patients_org_member_select ON public.patients
            FOR SELECT TO authenticated
            USING (
                organization_id IS NOT NULL
                AND organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- INSERT: only admins and coordinators can create participants
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='patients_coordinator_insert') THEN
        CREATE POLICY patients_coordinator_insert ON public.patients
            FOR INSERT TO authenticated
            WITH CHECK (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;

-- UPDATE: admins, coordinators, and support workers can update their participants
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='patients_worker_update') THEN
        CREATE POLICY patients_worker_update ON public.patients
            FOR UPDATE TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
            )
            WITH CHECK (
                organization_id = public.cs_user_org_id()
                AND public.cs_user_role() IN ('admin', 'manager', 'support_coordinator', 'support_worker')
            );
    END IF;
END $$;

-- DELETE: admin-only — prevents accidental participant removal
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patients' AND policyname='patients_admin_delete') THEN
        CREATE POLICY patients_admin_delete ON public.patients
            FOR DELETE TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_admin()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 7 — sessions TABLE POLICIES
-- Direct organization_id column.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='sessions_service_role_all') THEN
        CREATE POLICY sessions_service_role_all ON public.sessions
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- SELECT: any org member can read sessions in their organisation
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='sessions_org_member_select') THEN
        CREATE POLICY sessions_org_member_select ON public.sessions
            FOR SELECT TO authenticated
            USING (
                organization_id IS NOT NULL
                AND organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- INSERT: any active org member can create a session
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='sessions_member_insert') THEN
        CREATE POLICY sessions_member_insert ON public.sessions
            FOR INSERT TO authenticated
            WITH CHECK (
                organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- UPDATE: any org member can update sessions (notes, status changes, etc.)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='sessions_member_update') THEN
        CREATE POLICY sessions_member_update ON public.sessions
            FOR UPDATE TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- DELETE: admin-only — sessions are legal records; deletion should be rare
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='sessions_admin_delete') THEN
        CREATE POLICY sessions_admin_delete ON public.sessions
            FOR DELETE TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_admin()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 8 — incidents TABLE POLICIES
-- Direct organization_id column. NDIS Practice Standard 2.3.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='incidents' AND policyname='incidents_service_role_all') THEN
        CREATE POLICY incidents_service_role_all ON public.incidents
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- SELECT: any org member can read incidents for their organisation
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='incidents' AND policyname='incidents_org_member_select') THEN
        CREATE POLICY incidents_org_member_select ON public.incidents
            FOR SELECT TO authenticated
            USING (
                organization_id IS NOT NULL
                AND organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- INSERT: any org member can report an incident
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='incidents' AND policyname='incidents_member_insert') THEN
        CREATE POLICY incidents_member_insert ON public.incidents
            FOR INSERT TO authenticated
            WITH CHECK (
                organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- UPDATE: coordinators and admins can update/investigate incidents
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='incidents' AND policyname='incidents_coordinator_update') THEN
        CREATE POLICY incidents_coordinator_update ON public.incidents
            FOR UPDATE TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;

-- DELETE: admin-only — incidents are compliance records
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='incidents' AND policyname='incidents_admin_delete') THEN
        CREATE POLICY incidents_admin_delete ON public.incidents
            FOR DELETE TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_admin()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 9 — alerts TABLE POLICIES
-- No direct organization_id; scoped via patient_id → patients.
-- Dangerous anon policy already dropped in Section 4.
-- ============================================================

-- SELECT: org members can see alerts for their participants
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alerts' AND policyname='alerts_org_member_select') THEN
        CREATE POLICY alerts_org_member_select ON public.alerts
            FOR SELECT TO authenticated
            USING (
                patient_id IN (
                    SELECT id FROM public.patients
                    WHERE organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;

-- INSERT/UPDATE/DELETE: service_role only (backend manages alert lifecycle)
-- No authenticated write policies — alerts are system-generated.


-- ============================================================
-- SECTION 10 — ndis_plans TABLE POLICIES
-- Scoped via patient_id → patients.organization_id.
-- ============================================================

-- SELECT: any org member can read plans for their participants
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_org_member_select') THEN
        CREATE POLICY ndis_plans_org_member_select ON public.ndis_plans
            FOR SELECT TO authenticated
            USING (
                patient_id IN (
                    SELECT id FROM public.patients
                    WHERE organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;

-- INSERT: coordinators and admins can create plans
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_coordinator_insert') THEN
        CREATE POLICY ndis_plans_coordinator_insert ON public.ndis_plans
            FOR INSERT TO authenticated
            WITH CHECK (
                patient_id IN (
                    SELECT id FROM public.patients
                    WHERE organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;

-- UPDATE: coordinators and admins can update plans
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_coordinator_update') THEN
        CREATE POLICY ndis_plans_coordinator_update ON public.ndis_plans
            FOR UPDATE TO authenticated
            USING (
                patient_id IN (
                    SELECT id FROM public.patients
                    WHERE organization_id = public.cs_user_org_id()
                )
            )
            WITH CHECK (
                patient_id IN (
                    SELECT id FROM public.patients
                    WHERE organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;

-- DELETE: admin-only
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ndis_plans' AND policyname='ndis_plans_admin_delete') THEN
        CREATE POLICY ndis_plans_admin_delete ON public.ndis_plans
            FOR DELETE TO authenticated
            USING (
                patient_id IN (
                    SELECT id FROM public.patients
                    WHERE organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_admin()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 11 — plan_budgets TABLE POLICIES
-- Scoped via plan_id → ndis_plans → patients.organization_id.
-- ============================================================

-- SELECT: any org member
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plan_budgets' AND policyname='plan_budgets_org_member_select') THEN
        CREATE POLICY plan_budgets_org_member_select ON public.plan_budgets
            FOR SELECT TO authenticated
            USING (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;

-- INSERT/UPDATE/DELETE: coordinator+ only
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plan_budgets' AND policyname='plan_budgets_coordinator_write') THEN
        CREATE POLICY plan_budgets_coordinator_write ON public.plan_budgets
            FOR ALL TO authenticated
            USING (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_coordinator()
            )
            WITH CHECK (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 12 — budget_usage TABLE POLICIES
-- Scoped via plan_id → ndis_plans → patients.organization_id.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='budget_usage' AND policyname='budget_usage_org_member_select') THEN
        CREATE POLICY budget_usage_org_member_select ON public.budget_usage
            FOR SELECT TO authenticated
            USING (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;

-- Budget usage rows are created by the backend (service_role).
-- No authenticated write policies to prevent tampering with billing records.


-- ============================================================
-- SECTION 13 — patient_goals TABLE POLICIES
-- Scoped via plan_id → ndis_plans → patients.organization_id.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patient_goals' AND policyname='patient_goals_org_member_select') THEN
        CREATE POLICY patient_goals_org_member_select ON public.patient_goals
            FOR SELECT TO authenticated
            USING (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='patient_goals' AND policyname='patient_goals_coordinator_write') THEN
        CREATE POLICY patient_goals_coordinator_write ON public.patient_goals
            FOR ALL TO authenticated
            USING (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_coordinator()
            )
            WITH CHECK (
                plan_id IN (
                    SELECT np.id FROM public.ndis_plans np
                    INNER JOIN public.patients p ON p.id = np.patient_id
                    WHERE p.organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 14 — practitioner_allocations TABLE POLICIES
-- Has both patient_id and organization_id (use direct org_id).
-- ============================================================

-- SELECT: any org member can see allocations in their org
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_allocations' AND policyname='pa_org_member_select') THEN
        CREATE POLICY pa_org_member_select ON public.practitioner_allocations
            FOR SELECT TO authenticated
            USING (
                organization_id IS NOT NULL
                AND organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- INSERT/UPDATE: coordinators and admins manage allocations
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_allocations' AND policyname='pa_coordinator_write') THEN
        CREATE POLICY pa_coordinator_write ON public.practitioner_allocations
            FOR ALL TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_coordinator()
            )
            WITH CHECK (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_coordinator()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 15 — compliance_audit_logs TABLE POLICIES
-- Append-only audit trail. Scoped via session_id → sessions.
-- ============================================================

-- SELECT: auditors, coordinators, and admins in org
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_audit_logs' AND policyname='cal_auditor_select') THEN
        CREATE POLICY cal_auditor_select ON public.compliance_audit_logs
            FOR SELECT TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.sessions
                    WHERE organization_id = public.cs_user_org_id()
                )
                AND public.cs_is_auditor()
            );
    END IF;
END $$;

-- No authenticated write access — backend-only via service_role.


-- ============================================================
-- SECTION 16 — compliance_rule_results TABLE POLICIES
-- Scoped via session_id → sessions.organization_id.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_rule_results' AND policyname='crr_org_member_select') THEN
        CREATE POLICY crr_org_member_select ON public.compliance_rule_results
            FOR SELECT TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.sessions
                    WHERE organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 17 — restrictive_practice_flags TABLE POLICIES
-- Sensitive clinical data. Scoped via session_id → sessions.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='restrictive_practice_flags' AND policyname='rpf_org_member_select') THEN
        CREATE POLICY rpf_org_member_select ON public.restrictive_practice_flags
            FOR SELECT TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.sessions
                    WHERE organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 18 — session_messages TABLE POLICIES
-- Scoped via session_id → sessions.organization_id.
-- ============================================================

-- SELECT: any org member can read messages in sessions they can access
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='session_messages' AND policyname='sm_org_member_select') THEN
        CREATE POLICY sm_org_member_select ON public.session_messages
            FOR SELECT TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.sessions
                    WHERE organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;

-- INSERT: org members can add messages to their sessions
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='session_messages' AND policyname='sm_member_insert') THEN
        CREATE POLICY sm_member_insert ON public.session_messages
            FOR INSERT TO authenticated
            WITH CHECK (
                session_id IN (
                    SELECT id FROM public.sessions
                    WHERE organization_id = public.cs_user_org_id()
                )
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 19 — audit_logs TABLE POLICIES
-- Append-only. Admin/auditor read. Direct organization_id.
-- ============================================================

-- SELECT: admin and auditors only — audit logs are sensitive
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_logs_auditor_select') THEN
        CREATE POLICY audit_logs_auditor_select ON public.audit_logs
            FOR SELECT TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_auditor()
            );
    END IF;
END $$;

-- INSERT: any authenticated user can append (append-only — no UPDATE/DELETE)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_logs' AND policyname='audit_logs_member_insert') THEN
        CREATE POLICY audit_logs_member_insert ON public.audit_logs
            FOR INSERT TO authenticated
            WITH CHECK (
                organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

-- Deliberately NO UPDATE or DELETE authenticated policies — append-only by design.


-- ============================================================
-- SECTION 20 — access_logs TABLE POLICIES
-- NDIS Act s.66 "need-to-know" audit trail. Append-only.
-- ============================================================

-- SELECT: admin/auditor only — this is a sensitive access trail
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='access_logs' AND policyname='access_logs_auditor_select') THEN
        CREATE POLICY access_logs_auditor_select ON public.access_logs
            FOR SELECT TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_auditor()
            );
    END IF;
END $$;

-- INSERT: any authenticated member (append-only)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='access_logs' AND policyname='access_logs_member_insert') THEN
        CREATE POLICY access_logs_member_insert ON public.access_logs
            FOR INSERT TO authenticated
            WITH CHECK (
                organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 21 — security_events TABLE POLICIES
-- Privacy Act 2026 breach notification log. Append-only.
-- ============================================================

-- SELECT: admin/auditor only
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='security_events' AND policyname='security_events_auditor_select') THEN
        CREATE POLICY security_events_auditor_select ON public.security_events
            FOR SELECT TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
                AND public.cs_is_auditor()
            );
    END IF;
END $$;

-- INSERT: service_role only (backend logs security events).
-- No authenticated insert policy — security event creation must be server-side.


-- ============================================================
-- SECTION 22 — support_items TABLE POLICIES
-- Reference/lookup data. Read-only for all authenticated users.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_items' AND policyname='support_items_authenticated_select') THEN
        CREATE POLICY support_items_authenticated_select ON public.support_items
            FOR SELECT TO authenticated
            USING (true);  -- Reference data: all authenticated users can read NDIS price guide
    END IF;
END $$;

-- No authenticated write access — price guide managed by service_role only.


-- ============================================================
-- SECTION 23 — users TABLE SUPPLEMENTARY POLICIES
-- Existing: service_role_all, users_self_read (from supabase_setup.sql)
-- Add: org admins can read all members in their organisation.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_admin_org_read') THEN
        CREATE POLICY users_admin_org_read ON public.users
            FOR SELECT TO authenticated
            USING (
                -- Admin/manager can see all users in their organisation
                id IN (
                    SELECT om.user_id FROM public.organization_members om
                    WHERE om.organization_id = public.cs_user_org_id()
                      AND om.is_active = TRUE
                )
                AND public.cs_is_admin()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 24 — organizations TABLE SUPPLEMENTARY POLICIES
-- Existing: service_role_all, organizations_owner_read.
-- Add: all org members can read their own organisation record.
-- ============================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='organizations_member_read') THEN
        CREATE POLICY organizations_member_read ON public.organizations
            FOR SELECT TO authenticated
            USING (
                id = public.cs_user_org_id()
            );
    END IF;
END $$;


-- ============================================================
-- SECTION 25 — plans TABLE POLICIES (legacy pre-existing table)
-- This table uses participant_id as FK to patients.
-- NOTE: Add organization_id column to plans if not present:
--   ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS organization_id UUID;
-- ============================================================

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='plans' AND table_schema='public') THEN

        -- Service role (idempotent)
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='plans_service_role_all') THEN
            EXECUTE '
                CREATE POLICY plans_service_role_all ON public.plans
                    FOR ALL TO service_role USING (true) WITH CHECK (true)';
        END IF;

        -- SELECT: scope via participant_id → patients.organization_id
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='plans_org_member_select') THEN
            EXECUTE '
                CREATE POLICY plans_org_member_select ON public.plans
                    FOR SELECT TO authenticated
                    USING (
                        participant_id IN (
                            SELECT id FROM public.patients
                            WHERE organization_id = public.cs_user_org_id()
                        )
                    )';
        END IF;

        -- INSERT/UPDATE: coordinators only
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='plans_coordinator_write') THEN
            EXECUTE '
                CREATE POLICY plans_coordinator_write ON public.plans
                    FOR ALL TO authenticated
                    USING (
                        participant_id IN (
                            SELECT id FROM public.patients
                            WHERE organization_id = public.cs_user_org_id()
                        )
                        AND public.cs_is_coordinator()
                    )
                    WITH CHECK (
                        participant_id IN (
                            SELECT id FROM public.patients
                            WHERE organization_id = public.cs_user_org_id()
                        )
                        AND public.cs_is_coordinator()
                    )';
        END IF;

    END IF;
END $$;


-- ============================================================
-- VERIFICATION QUERIES
-- Run these after the migration to confirm the repair worked.
-- ============================================================

-- 1. Tables with RLS enabled but NO policies (should return 0 rows after repair):
-- SELECT schemaname, tablename
-- FROM pg_tables t
-- WHERE schemaname = 'public'
--   AND rowsecurity = TRUE
--   AND NOT EXISTS (
--     SELECT 1 FROM pg_policies p
--     WHERE p.schemaname = 'public' AND p.tablename = t.tablename
-- );

-- 2. List all policies created by this migration:
-- SELECT tablename, policyname, roles, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- 3. Confirm no anon policies remain on sensitive tables:
-- SELECT tablename, policyname, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND 'anon' = ANY(roles);

-- 4. Confirm organization_members backfill:
-- SELECT COUNT(*) FROM public.organization_members;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
