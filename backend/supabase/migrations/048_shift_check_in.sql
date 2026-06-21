-- CARECLIQV2-197 — GPS/QR verified shift check-in

BEGIN;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS clock_in_method TEXT
        CHECK (clock_in_method IS NULL OR clock_in_method IN ('gps', 'qr', 'manual')),
    ADD COLUMN IF NOT EXISTS clock_in_location JSONB,
    ADD COLUMN IF NOT EXISTS clock_in_verified BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS participant_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS participant_longitude DOUBLE PRECISION;

COMMENT ON COLUMN public.shifts.clock_in_method IS
    'How the worker verified arrival: gps, qr, or manual (legacy).';
COMMENT ON COLUMN public.shifts.clock_in_location IS
    'Worker device location at check-in: {lat, lng, accuracy}.';
COMMENT ON COLUMN public.shifts.clock_in_verified IS
    'True when GPS geofence or QR token validation succeeded.';

CREATE TABLE IF NOT EXISTS public.participant_check_in_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Primary location',
    token_hash TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participant_check_in_codes_participant
    ON public.participant_check_in_codes (participant_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.shift_check_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('gps', 'qr', 'manual')),
    location JSONB,
    verified BOOLEAN NOT NULL DEFAULT false,
    verification_distance_meters DOUBLE PRECISION,
    qr_code_id UUID REFERENCES public.participant_check_in_codes(id) ON DELETE SET NULL,
    client_timestamp TIMESTAMPTZ,
    server_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_check_ins_shift
    ON public.shift_check_ins (shift_id, created_at DESC);

ALTER TABLE public.participant_check_in_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_check_ins ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'participant_check_in_codes' AND policyname = 'participant_check_in_codes_service_role'
    ) THEN
        CREATE POLICY participant_check_in_codes_service_role ON public.participant_check_in_codes
        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_check_ins' AND policyname = 'shift_check_ins_service_role'
    ) THEN
        CREATE POLICY shift_check_ins_service_role ON public.shift_check_ins
        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

COMMIT;
