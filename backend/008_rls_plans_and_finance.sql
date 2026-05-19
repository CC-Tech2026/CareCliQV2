CREATE POLICY ndis_plans_select ON public.ndis_plans
FOR SELECT TO authenticated
USING (
  patient_id IN (
    SELECT id FROM public.patients
    WHERE organization_id = public.cs_user_org_id()
  )
);

CREATE POLICY ndis_plans_write ON public.ndis_plans
FOR INSERT TO authenticated
WITH CHECK (
  patient_id IN (
    SELECT id FROM public.patients
    WHERE organization_id = public.cs_user_org_id()
  )
);