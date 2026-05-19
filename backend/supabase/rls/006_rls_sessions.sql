CREATE POLICY sessions_select ON public.sessions
FOR SELECT TO authenticated
USING (organization_id = public.cs_user_org_id());

CREATE POLICY sessions_write ON public.sessions
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.cs_user_org_id());