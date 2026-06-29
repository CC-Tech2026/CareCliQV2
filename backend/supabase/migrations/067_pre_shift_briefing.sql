-- Pre-shift briefing interface

BEGIN;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS background_summary TEXT,
    ADD COLUMN IF NOT EXISTS background_summary_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS briefing_content_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS special_instructions TEXT,
    ADD COLUMN IF NOT EXISTS briefing_content_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.participant_briefing_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    alert_text TEXT NOT NULL CHECK (char_length(trim(alert_text)) > 0),
    sort_order SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 2),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participant_briefing_alerts_participant
    ON public.participant_briefing_alerts (participant_id)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.shift_briefing_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    patient_briefing_version INTEGER NOT NULL DEFAULT 1,
    shift_briefing_version INTEGER NOT NULL DEFAULT 1,
    scrolled_to_bottom BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (shift_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_briefing_ack_shift
    ON public.shift_briefing_acknowledgements (shift_id, worker_id);

CREATE TABLE IF NOT EXISTS public.shift_briefing_alert_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    alert_id UUID NOT NULL REFERENCES public.participant_briefing_alerts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shift_id, alert_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_briefing_alert_ack_shift
    ON public.shift_briefing_alert_acknowledgements (shift_id, worker_id);

ALTER TABLE public.participant_briefing_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_briefing_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_briefing_alert_acknowledgements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'participant_briefing_alerts'
          AND policyname = 'participant_briefing_alerts_service_all'
    ) THEN
        CREATE POLICY participant_briefing_alerts_service_all
            ON public.participant_briefing_alerts FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'shift_briefing_acknowledgements'
          AND policyname = 'shift_briefing_ack_service_all'
    ) THEN
        CREATE POLICY shift_briefing_ack_service_all
            ON public.shift_briefing_acknowledgements FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'shift_briefing_alert_acknowledgements'
          AND policyname = 'shift_briefing_alert_ack_service_all'
    ) THEN
        CREATE POLICY shift_briefing_alert_ack_service_all
            ON public.shift_briefing_alert_acknowledgements FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON COLUMN public.patients.background_summary IS
    'Coordinator-authored 2–4 sentence participant background for pre-shift briefing (CARECLIQV2-267).';

COMMENT ON COLUMN public.shifts.special_instructions IS
    'Per-shift coordinator instructions shown only on that shift briefing (CARECLIQV2-267).';

COMMIT;
