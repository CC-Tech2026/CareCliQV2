CREATE OR REPLACE FUNCTION public.cs_user_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND is_active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cs_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND is_active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cs_is_coordinator()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
      AND role = 'support_coordinator'
      AND is_active = TRUE
  );
$$;

-- Legacy helper name retained for older policies. The only oversight role is
-- support_coordinator.
CREATE OR REPLACE FUNCTION public.cs_is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cs_is_coordinator();
$$;
