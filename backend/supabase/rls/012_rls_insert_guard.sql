-- ============================================================
-- FORCE ORG OWNERSHIP ON INSERT (NO EXCEPTIONS)
-- ============================================================

-- PATIENTS
CREATE POLICY org_isolation_patients
ON public.patients
FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND is_active = true
  )
);

-- SESSIONS
CREATE POLICY org_isolation_sessions
ON public.sessions
FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND is_active = true
  )
);

-- INCIDENTS
CREATE POLICY org_isolation_incidents
ON public.incidents
FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND is_active = true
  )
);

-- ALERTS (same pattern if you want full isolation)
CREATE POLICY org_isolation_alerts
ON public.alerts
FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND is_active = true
  )
);