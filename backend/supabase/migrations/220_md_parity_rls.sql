-- Stated policy (2026-09-27): managing_director is a strict superset of
-- support_coordinator everywhere it isn't explicitly Coordinator's own
-- operational domain (coordinator.py's _require_coordinator() and its ~48
-- endpoints are the one documented exception, deliberately left alone here).
-- 219_service_agreements_md_access.sql already fixed this pattern for
-- service_agreements/service_agreement_supports; this migration propagates
-- the same fix to the two other places it was found: the cs_is_coordinator()
-- RLS helper (used by session_attachments and shift_office_messages
-- policies) and ndis_price_schedules' insert policy (ndis_price_items has an
-- equivalent gap, but a later permissive policy in
-- 025_ndis_pricing_effective_dated.sql already covers it — not touched here).
--
-- Same caveat as 219: the backend always queries via the service-role client
-- (bypasses RLS), so this hasn't blocked anything in practice yet — still
-- wrong by the codebase's own stated standard.

BEGIN;

-- cs_is_coordinator() is defined identically 3x across migration history
-- (003, 006, 052) — CREATE OR REPLACE updates the one live function
-- definition; the historical files are left untouched (existing convention).
-- cs_is_admin() delegates to this function, so it's fixed too without a
-- separate change.
CREATE OR REPLACE FUNCTION cs_is_coordinator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND role IN ('support_coordinator', 'managing_director')
      AND is_active = true
  );
$$;

DROP POLICY IF EXISTS "Coordinators can insert price schedules" ON ndis_price_schedules;
CREATE POLICY "Coordinators and MDs can insert price schedules" ON ndis_price_schedules
    FOR INSERT WITH CHECK (
        organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()) AND
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE user_id = auth.uid() AND
                  organization_id = ndis_price_schedules.organization_id AND
                  role IN ('support_coordinator', 'managing_director')
        )
    );

COMMIT;
