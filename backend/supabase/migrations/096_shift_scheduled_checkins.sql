-- Random compliance check-ins for 6+ hour shifts (Check 16 scheduling refactor)

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_scheduled_checkins (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    shift_id                UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id               UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id         UUID        REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    sequence_number         SMALLINT    NOT NULL CHECK (sequence_number BETWEEN 1 AND 3),
    scheduled_at            TIMESTAMPTZ NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'prompted', 'completed', 'missed')),
    prompted_at             TIMESTAMPTZ,
    response_deadline_at    TIMESTAMPTZ,
    shift_checkin_id        UUID        REFERENCES public.shift_checkins(id) ON DELETE SET NULL,
    notification_reference_key TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_scheduled_checkins_session
    ON public.shift_scheduled_checkins (session_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_shift_scheduled_checkins_active
    ON public.shift_scheduled_checkins (status, scheduled_at)
    WHERE status IN ('pending', 'prompted');

ALTER TABLE public.user_push_tokens
    ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'expo'
    CHECK (token_type IN ('expo', 'fcm'));

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS random_checkins_scheduled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.shift_scheduled_checkins ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_scheduled_checkins'
          AND policyname = 'shift_scheduled_checkins_service_role'
    ) THEN
        CREATE POLICY shift_scheduled_checkins_service_role
            ON public.shift_scheduled_checkins
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
