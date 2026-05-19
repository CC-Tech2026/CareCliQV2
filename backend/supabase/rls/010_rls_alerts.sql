CREATE POLICY alerts_select ON public.alerts
FOR SELECT TO authenticated
USING (organization_id = public.cs_user_org_id());

CREATE POLICY alerts_write ON public.alerts
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.cs_user_org_id());