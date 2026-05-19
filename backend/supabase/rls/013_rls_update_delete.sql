-- ============================================================
-- UPDATE/DELETE IS STRICTLY SAME ORG ONLY
-- ============================================================

CREATE POLICY patients_update
ON public.patients
FOR UPDATE
TO authenticated
USING (organization_id = public.cs_user_org_id())
WITH CHECK (organization_id = public.cs_user_org_id());

CREATE POLICY patients_delete
ON public.patients
FOR DELETE
TO authenticated
USING (organization_id = public.cs_user_org_id());

CREATE POLICY sessions_update
ON public.sessions
FOR UPDATE
TO authenticated
USING (organization_id = public.cs_user_org_id())
WITH CHECK (organization_id = public.cs_user_org_id());

CREATE POLICY sessions_delete
ON public.sessions
FOR DELETE
TO authenticated
USING (organization_id = public.cs_user_org_id());

CREATE POLICY incidents_update
ON public.incidents
FOR UPDATE
TO authenticated
USING (organization_id = public.cs_user_org_id())
WITH CHECK (organization_id = public.cs_user_org_id());

CREATE POLICY incidents_delete
ON public.incidents
FOR DELETE
TO authenticated
USING (organization_id = public.cs_user_org_id());