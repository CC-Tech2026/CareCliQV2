-- Tracks how long a new hire has been blocked on a specific onboarding stage
-- (credentials, training) so the scheduler can remind them after 3 days and
-- auto-set them inactive after 14 days if they still haven't acted. Mirrors
-- the shape of ndis_screening_recheck_reminders (122) and medication dose
-- reminders — one row per pending case, stamped once actioned so repeated
-- scheduler passes don't re-send or re-escalate.
--
-- Rows are deleted (not soft-closed) once a worker resolves the block, so a
-- future block on the same stage starts its own fresh 3/14 day window.

BEGIN;

CREATE TABLE IF NOT EXISTS public.onboarding_stage_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('credentials', 'training')),
    first_flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reminder_sent_at TIMESTAMPTZ,
    escalated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (worker_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_stage_reminders_pending
    ON public.onboarding_stage_reminders (organization_id)
    WHERE escalated_at IS NULL;

ALTER TABLE public.onboarding_stage_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_stage_reminders_service_role
    ON public.onboarding_stage_reminders
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
