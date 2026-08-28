-- Tenant isolation follow-up (2026-08-28): the Worker-Participant Matching tables added in
-- 144_participant_worker_tags.sql, 145_tag_category_matching_role.sql, and
-- 146_shift_match_feedback.sql never had RLS enabled — same gap class as
-- 140_enable_missing_tenant_rls.sql, found during an audit for a follow-on onboarding/matching
-- feature. None of these tables are queried directly by the frontend (the backend exclusively
-- uses the service_role client), so the correct, lowest-risk fix is the same deny-by-default
-- pattern used there: enable RLS, add a single service_role-only policy.
--
-- tag_category_matching_role only adds a column to the already-existing tag_categories table,
-- so it's covered by tag_categories being listed here, not separately.

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'tag_categories', 'tags', 'participant_tags', 'worker_tags', 'shift_match_feedback'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t
                  AND policyname = t || '_service_role_all'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
                    t || '_service_role_all', t
                );
            END IF;
        END IF;
    END LOOP;
END $$;
