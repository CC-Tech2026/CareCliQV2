-- Staff operational feedback/complaints: any staff member can flag something
-- that isn't working or file a report about an operational issue, separate
-- from incident reporting (which is participant-safety-focused and has its
-- own immutable-record workflow). Coordinators and the managing director
-- review and resolve these org-wide.

BEGIN;

CREATE TABLE IF NOT EXISTS public.operational_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'other'
        CHECK (category IN ('process', 'equipment', 'scheduling', 'communication', 'safety_non_incident', 'other')),
    title TEXT NOT NULL CHECK (char_length(trim(title)) >= 1),
    description TEXT NOT NULL CHECK (char_length(trim(description)) >= 1),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
    resolution_notes TEXT,
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_feedback_org
    ON public.operational_feedback (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_feedback_reporter
    ON public.operational_feedback (reporter_id, created_at DESC);

COMMENT ON TABLE public.operational_feedback IS
    'Staff-submitted complaints/feedback about operational issues (not participant-safety incidents). Org-wide visibility for coordinators/MD.';
COMMENT ON COLUMN public.operational_feedback.category IS
    'Rough bucket for the report: process, equipment, scheduling, communication, safety_non_incident, other.';

ALTER TABLE public.operational_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'operational_feedback'
          AND policyname = 'operational_feedback_service_all'
    ) THEN
        CREATE POLICY operational_feedback_service_all
            ON public.operational_feedback
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
