-- ============================================================
-- HARD MULTI-TENANT ISOLATION BASE RULE
-- ============================================================

-- Prevent cross-org SELECT leakage fallback
CREATE POLICY org_isolation_select
ON public.patients
FOR SELECT
TO authenticated
USING (
  organization_id = public.cs_user_org_id()
);

CREATE POLICY org_isolation_select_sessions
ON public.sessions
FOR SELECT
TO authenticated
USING (
  organization_id = public.cs_user_org_id()
);

CREATE POLICY org_isolation_select_incidents
ON public.incidents
FOR SELECT
TO authenticated
USING (
  organization_id = public.cs_user_org_id()
);

CREATE POLICY org_isolation_select_alerts
ON public.alerts
FOR SELECT
TO authenticated
USING (
  organization_id = public.cs_user_org_id()
);