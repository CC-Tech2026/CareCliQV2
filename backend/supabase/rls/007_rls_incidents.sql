CREATE POLICY incidents_select ON public.incidents
FOR SELECT TO authenticated
USING (organization_id = public.cs_user_org_id());

CREATE POLICY incidents_write ON public.incidents
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.cs_user_org_id());