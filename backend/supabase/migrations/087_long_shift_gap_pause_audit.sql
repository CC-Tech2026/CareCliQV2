-- Check 16 addendum follow-up: offline gap pause, compliance flags, org settings (Q1 v2-ready)

BEGIN;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS gap_paused_secs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS offline_since_at TIMESTAMPTZ;
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS compliance_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS engagement_check16 JSONB;

CREATE TABLE IF NOT EXISTS public.organization_long_shift_settings (
    organization_id           UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    checkin_gap_minutes         INTEGER NOT NULL DEFAULT 90
        CHECK (checkin_gap_minutes BETWEEN 60 AND 180),
    activity_gap_fail_minutes   INTEGER NOT NULL DEFAULT 120
        CHECK (activity_gap_fail_minutes BETWEEN 90 AND 240),
    long_shift_threshold_hours  NUMERIC(4, 1) NOT NULL DEFAULT 4.0
        CHECK (long_shift_threshold_hours >= 4.0 AND long_shift_threshold_hours <= 8.0),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_long_shift_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'organization_long_shift_settings'
          AND policyname = 'organization_long_shift_settings_service_role'
    ) THEN
        CREATE POLICY organization_long_shift_settings_service_role
            ON public.organization_long_shift_settings
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
