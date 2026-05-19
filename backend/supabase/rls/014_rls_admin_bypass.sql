CREATE POLICY admin_override_patients
ON public.patients
FOR ALL
TO authenticated
USING (public.cs_is_admin())
WITH CHECK (public.cs_is_admin());