-- Worker incident reporting: reference numbers, worker fields, correction notes

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS reference_number TEXT,
    ADD COLUMN IF NOT EXISTS worker_report_type TEXT,
    ADD COLUMN IF NOT EXISTS behaviour_subtype TEXT,
    ADD COLUMN IF NOT EXISTS participant_present BOOLEAN,
    ADD COLUMN IF NOT EXISTS participant_harmed TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_reference_number
    ON public.incidents (reference_number)
    WHERE reference_number IS NOT NULL;

COMMENT ON COLUMN public.incidents.reference_number IS
    'Human-readable reference INC-YYYYMMDD-XXXX shown to workers on submit.';
COMMENT ON COLUMN public.incidents.worker_report_type IS
    'Worker-facing type: safety_hazard, participant_behaviour, equipment_damage, travel_accident, other.';
COMMENT ON COLUMN public.incidents.behaviour_subtype IS
    'When worker_report_type is participant_behaviour: verbal, physical, property.';

CREATE TABLE IF NOT EXISTS public.incident_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    note TEXT NOT NULL CHECK (char_length(trim(note)) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_corrections_incident
    ON public.incident_corrections (incident_id, created_at DESC);

COMMENT ON TABLE public.incident_corrections IS
    'Append-only correction notes from workers; original incident record stays immutable.';

CREATE TABLE IF NOT EXISTS public.incident_reference_counters (
    ref_date DATE PRIMARY KEY,
    next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq >= 1)
);

CREATE OR REPLACE FUNCTION public.generate_incident_reference_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    today DATE := (timezone('UTC', now()))::date;
    seq_num INTEGER;
    ref TEXT;
BEGIN
    INSERT INTO public.incident_reference_counters (ref_date, next_seq)
    VALUES (today, 2)
    ON CONFLICT (ref_date) DO UPDATE
        SET next_seq = public.incident_reference_counters.next_seq + 1
    RETURNING next_seq - 1 INTO seq_num;

    ref := 'INC-' || to_char(today, 'YYYYMMDD') || '-' || lpad(seq_num::text, 4, '0');
    RETURN ref;
END;
$$;

ALTER TABLE public.incident_corrections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'incident_corrections'
          AND policyname = 'incident_corrections_service_all'
    ) THEN
        CREATE POLICY incident_corrections_service_all
            ON public.incident_corrections
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
