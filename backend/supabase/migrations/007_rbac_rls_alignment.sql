-- Align RLS helper role semantics with application RBAC.
-- Unknown legacy roles such as manager/auditor must not gain permissions.

CREATE OR REPLACE FUNCTION public.cs_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND role IN ('admin', 'support_coordinator')
  );
$$;

CREATE OR REPLACE FUNCTION public.cs_can_manage()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND role IN ('admin', 'support_coordinator')
  );
$$;

CREATE OR REPLACE FUNCTION public.cs_is_auditor()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cs_is_admin();
$$;

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

UPDATE public.organization_members
SET status = 'removed',
    role = 'support_worker',
    updated_at = now()
WHERE role IN ('manager', 'auditor');

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('admin', 'support_coordinator', 'support_worker', 'allied_health'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE public.users
SET role = 'support_worker',
    status = 'removed',
    updated_at = now()
WHERE role IN ('manager', 'auditor');

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'support_coordinator', 'support_worker', 'allied_health'));

ALTER TABLE public.practitioner_allocations
  DROP CONSTRAINT IF EXISTS practitioner_allocations_allocated_role_check;

UPDATE public.practitioner_allocations
SET allocated_role = CASE
    WHEN allocated_role = 'primary_ot' THEN 'allied_health'
    ELSE 'support_worker'
  END,
  assignment_role = CASE
    WHEN allocated_role = 'primary_ot' THEN 'allied_health'
    ELSE 'support_worker'
  END,
  status = CASE
    WHEN allocated_role = 'supervisor' THEN 'removed'
    ELSE status
  END,
  updated_at = now()
WHERE allocated_role IN ('primary_ot', 'supervisor');

ALTER TABLE public.practitioner_allocations
  ADD CONSTRAINT practitioner_allocations_allocated_role_check
  CHECK (allocated_role IN ('support_worker', 'allied_health'));
