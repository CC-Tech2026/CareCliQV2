CREATE POLICY patients_select ON public.patients
FOR SELECT TO authenticated
USING (organization_id = public.cs_user_org_id());

CREATE POLICY patients_write ON public.patients
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.cs_user_org_id());