CREATE POLICY audit_insert ON public.audit_logs
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.cs_user_org_id());

CREATE POLICY audit_select ON public.audit_logs
FOR SELECT TO authenticated
USING (
  organization_id = public.cs_user_org_id()
  AND public.cs_is_admin()
);