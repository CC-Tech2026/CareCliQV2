-- Bug reports: any staff member (worker/coordinator/managing director) can
-- report something broken in the product, from wherever they hit it.
-- Deliberately visible only through the Super Admin portal
-- (backend/app/api/admin.py), never to a provider's own coordinators/MD —
-- this is feedback about CareCliQ itself, not an operational issue within
-- the provider's own business (see 143_operational_feedback.sql for that,
-- which this table's shape otherwise mirrors).

BEGIN;

CREATE TABLE IF NOT EXISTS public.bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    page_url TEXT,
    description TEXT NOT NULL CHECK (char_length(trim(description)) >= 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_org
    ON public.bug_reports (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status
    ON public.bug_reports (status, created_at DESC);

COMMENT ON TABLE public.bug_reports IS
    'Staff-submitted bug reports about the CareCliQ product itself. Cross-org visibility is Super Admin only (see admin.py) — never surfaced to a provider''s own coordinators/MD.';

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'bug_reports'
          AND policyname = 'bug_reports_service_all'
    ) THEN
        CREATE POLICY bug_reports_service_all
            ON public.bug_reports
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
