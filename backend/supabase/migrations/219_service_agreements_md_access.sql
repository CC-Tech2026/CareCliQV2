-- 217_service_agreements.sql's write policies checked
-- role = 'support_coordinator' only, so a managing_director user would be
-- blocked at the RLS layer even though the API layer (service_agreements.py)
-- already correctly allows both via has_org_wide_access(). In practice the
-- backend always queries through the service-role client (bypasses RLS
-- entirely), so this hasn't caused a real block yet — but it's still wrong,
-- and would matter the moment anything queries these tables with a
-- user-scoped key instead. Stated policy going forward: managing_director
-- is a strict superset of support_coordinator everywhere — never more
-- restrictive. Confirmed live: 217's SELECT policies already allow any org
-- member (unaffected here); only the two write policies needed fixing.

BEGIN;

DROP POLICY IF EXISTS "Coordinators can manage service agreements" ON public.service_agreements;
CREATE POLICY "Coordinators and MDs can manage service agreements" ON public.service_agreements
    FOR ALL USING (
        organization_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE user_id = auth.uid()
              AND organization_id = service_agreements.organization_id
              AND role IN ('support_coordinator', 'managing_director')
        )
    );

DROP POLICY IF EXISTS "Coordinators can manage service agreement supports" ON public.service_agreement_supports;
CREATE POLICY "Coordinators and MDs can manage service agreement supports" ON public.service_agreement_supports
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.service_agreements sa
            JOIN public.organization_members om ON om.organization_id = sa.organization_id
            WHERE sa.id = service_agreement_supports.service_agreement_id
              AND om.user_id = auth.uid()
              AND om.role IN ('support_coordinator', 'managing_director')
        )
    );

COMMIT;
