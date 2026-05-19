-- ALL tables must belong to a valid org through membership

CREATE POLICY base_select_guard_patients
ON patients
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.user_id = auth.uid()
      AND om.is_active = true
  )
);