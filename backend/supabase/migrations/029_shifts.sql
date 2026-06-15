-- CARECLIQV2-87 — MyShift support worker shifts table
-- CARECLIQV2-35 — sessions.shift_id FK for duration consistency checks

BEGIN;

CREATE TABLE IF NOT EXISTS public.shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    participant_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    clocked_in_at TIMESTAMPTZ,
    clocked_out_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    participant_name TEXT,
    participant_dob DATE,
    participant_gender TEXT,
    participant_address TEXT,
    participant_phone TEXT,
    allergies TEXT,
    health_flags TEXT,
    health_alerts TEXT,
    visit_notes TEXT,
    access_instructions TEXT,
    coordinator_notes TEXT,
    entry_instructions TEXT,
    active_goals TEXT[],
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill columns when shifts was created by an earlier partial patch
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES public.patients(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS clocked_in_at TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS clocked_out_at TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_name TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_dob DATE;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_gender TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_address TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS participant_phone TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS health_flags TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS health_alerts TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS visit_notes TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS access_instructions TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS coordinator_notes TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS entry_instructions TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS active_goals TEXT[];
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON TABLE public.shifts IS
    'Support worker shifts (MyShift). Links to sessions when a shift is documented.';

COMMENT ON COLUMN public.shifts.duration_minutes IS
    'Actual shift duration in minutes (from clock-in/out or manual entry).';

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sessions.shift_id IS
    'Optional link to the MyShift shift this session documents (CARECLIQV2-35).';

CREATE INDEX IF NOT EXISTS idx_shifts_org_worker_scheduled
    ON public.shifts (organization_id, worker_id, scheduled_start DESC);

CREATE INDEX IF NOT EXISTS idx_shifts_session_id
    ON public.shifts (session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_shift_id
    ON public.sessions (shift_id)
    WHERE shift_id IS NOT NULL;

-- ── RLS — organisation-scoped reads; service role full access ─────────────────

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shifts' AND policyname = 'shifts_org_select'
    ) THEN
        CREATE POLICY shifts_org_select ON public.shifts
        FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shifts' AND policyname = 'shifts_service_role'
    ) THEN
        CREATE POLICY shifts_service_role ON public.shifts
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

COMMIT;
