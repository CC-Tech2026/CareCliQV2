-- Check 16 — Long Shift Engagement (CareCliQ addendum v1.0)
-- Activity tracking, check-ins, breaks, and session engagement metrics.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_activity_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID        REFERENCES public.sessions(id) ON DELETE CASCADE,
    shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    event_type      TEXT        NOT NULL
                    CHECK (event_type IN (
                        'NOTE_SAVED', 'TASK_TICKED', 'PHOTO_ADDED', 'VOICE_RECORDED',
                        'CHECK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_IN', 'CLOCK_OUT'
                    )),
    occurred_at     TIMESTAMPTZ NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    worker_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    patient_id      UUID        REFERENCES public.patients(id) ON DELETE SET NULL,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_billable     BOOLEAN     NOT NULL DEFAULT true,
    gap_before_secs INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shift_activity_events_session
    ON public.shift_activity_events (session_id, occurred_at)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shift_activity_events_shift
    ON public.shift_activity_events (shift_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.shift_checkins (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    shift_id            UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    patient_id          UUID        REFERENCES public.patients(id) ON DELETE SET NULL,
    status              TEXT        NOT NULL
                        CHECK (status IN ('GOING_WELL', 'NEEDS_ATTENTION', 'INCIDENT_REPORTED')),
    note                TEXT,
    prompt_triggered_at TIMESTAMPTZ NOT NULL,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    response_time_secs  INTEGER,
    gap_at_prompt_secs  INTEGER,
    linked_incident_id  UUID        REFERENCES public.incidents(id) ON DELETE SET NULL,
    coordinator_notified BOOLEAN    NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_checkins_session
    ON public.shift_checkins (session_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.shift_breaks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    break_start_at  TIMESTAMPTZ NOT NULL,
    break_end_at    TIMESTAMPTZ,
    duration_secs   INTEGER,
    is_compliant    BOOLEAN,
    break_number    SMALLINT    NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_breaks_session_active
    ON public.shift_breaks (session_id)
    WHERE break_end_at IS NULL;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS max_gap_secs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS checkin_count SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS break_duration_secs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS billable_duration_secs INTEGER;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS engagement_score SMALLINT;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_long_shift BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at
    ON public.sessions (last_activity_at)
    WHERE last_activity_at IS NOT NULL;

INSERT INTO public.compliance_rules
    (rule_code, name, description, severity, is_active, is_blocking, enforcement_tier)
SELECT
    'R16', 'Long shift engagement',
    'For shifts >= 4 hours: activity gaps must not exceed 120 minutes, check-ins required every 90 minutes, and breaks logged for 6+ hour shifts.',
    'medium', true, false, 'warn'
WHERE NOT EXISTS (
    SELECT 1 FROM public.compliance_rules WHERE rule_code = 'R16'
);

ALTER TABLE public.shift_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_breaks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'shift_activity_events' AND policyname = 'shift_activity_events_service_role'
    ) THEN
        CREATE POLICY shift_activity_events_service_role ON public.shift_activity_events
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'shift_checkins' AND policyname = 'shift_checkins_service_role'
    ) THEN
        CREATE POLICY shift_checkins_service_role ON public.shift_checkins
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'shift_breaks' AND policyname = 'shift_breaks_service_role'
    ) THEN
        CREATE POLICY shift_breaks_service_role ON public.shift_breaks
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
