CREATE OR REPLACE FUNCTION cs_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE
AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION cs_is_admin()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'support_coordinator')
      AND is_active = true
  );
$$;
