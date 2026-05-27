CREATE OR REPLACE FUNCTION cs_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION cs_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION cs_is_coordinator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND role = 'support_coordinator'
      AND is_active = true
  );
$$;

-- Legacy helper name retained for older policies. The only oversight role is
-- support_coordinator.
CREATE OR REPLACE FUNCTION cs_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cs_is_coordinator();
$$;
