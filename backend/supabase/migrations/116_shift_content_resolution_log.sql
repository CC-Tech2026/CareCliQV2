-- Shift Content Synchronization spec — audit trail for live medication resolution.
-- One append-only row per resolution call at the three checkpoints closest to the point of
-- care (pre_shift_briefing, action_time, mid_shift_change) — not every roster-time or
-- instance-generation check, to avoid excessive volume. Answers "what was a worker shown,
-- and when, and was anything correctly excluded" after the fact.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_content_resolution_log (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id                 UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    participant_id           UUID REFERENCES public.patients(id) ON DELETE SET NULL,
    organization_id          UUID NOT NULL,
    checkpoint               TEXT NOT NULL CHECK (checkpoint IN ('pre_shift_briefing', 'action_time', 'mid_shift_change')),
    resolved_medication_ids  UUID[] NOT NULL DEFAULT '{}',
    -- [{medication_id, status}] — the status each excluded medication had at exclusion time.
    excluded_medications     JSONB NOT NULL DEFAULT '[]'::jsonb,
    resolved_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_for_user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shift_content_resolution_shift
    ON public.shift_content_resolution_log(shift_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_content_resolution_org
    ON public.shift_content_resolution_log(organization_id, resolved_at DESC);

ALTER TABLE public.shift_content_resolution_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_content_resolution_log' AND policyname = 'shift_content_resolution_log_service_role'
    ) THEN
        CREATE POLICY shift_content_resolution_log_service_role ON public.shift_content_resolution_log
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
