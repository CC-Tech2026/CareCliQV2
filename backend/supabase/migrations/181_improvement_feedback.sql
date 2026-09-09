-- Improvements & Feedback: a managing director can send CareCliQ a feature
-- request, an improvement idea, or general product feedback — anything
-- that would make the system work better for their business. Deliberately
-- visible only through the Super Admin portal (backend/app/api/admin.py),
-- never to a provider's own coordinators/workers — this is feedback about
-- CareCliQ itself, same audience boundary as bug_reports
-- (180_bug_reports.sql), which this table's shape mirrors.

BEGIN;

CREATE TABLE IF NOT EXISTS public.improvement_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    description TEXT NOT NULL CHECK (char_length(trim(description)) >= 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_improvement_feedback_org
    ON public.improvement_feedback (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_improvement_feedback_status
    ON public.improvement_feedback (status, created_at DESC);

COMMENT ON TABLE public.improvement_feedback IS
    'MD-submitted feature requests/improvement feedback about the CareCliQ product itself. Cross-org visibility is Super Admin only (see admin.py) — never surfaced to the provider''s own coordinators/workers.';

ALTER TABLE public.improvement_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'improvement_feedback'
          AND policyname = 'improvement_feedback_service_all'
    ) THEN
        CREATE POLICY improvement_feedback_service_all
            ON public.improvement_feedback
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
