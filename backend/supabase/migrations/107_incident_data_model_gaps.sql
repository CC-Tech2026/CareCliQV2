-- Incident Management spec — data model gaps (identified_at, location_type,
-- connection_to_service, structured witnesses, reportability override, subject of allegation).
--
-- Deliberately does NOT touch what already exists and is a close match:
--   - occurred_at            -> already covered by incidents.incident_date
--   - harm_description       -> already covered by incidents.participant_impact
--   - reportable_category    -> already covered by incidents.practice_standard +
--                                incident_type (PRACTICE_STANDARD_MAP in schemas/incident.py)
--   - notification deadline  -> already computed (incident_service.py _enrich) and now
--                                escalated (106... see incident_notification_service.py)
-- The legacy free-text `witnesses` column stays as-is for historical rows; new structured
-- entries go in `witnesses_structured` — same "add alongside, don't rewrite" approach used
-- for patients.medications when the structured medications table was added.

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS identified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS location_type TEXT
        CHECK (location_type IN ('private_home', 'supported_accommodation', 'provider_premises', 'community', 'other')),
    ADD COLUMN IF NOT EXISTS witnesses_structured JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS connection_to_service BOOLEAN,
    ADD COLUMN IF NOT EXISTS connection_to_service_reasoning TEXT,
    ADD COLUMN IF NOT EXISTS ndis_reportable_override BOOLEAN,
    ADD COLUMN IF NOT EXISTS ndis_reportable_override_reason TEXT,
    ADD COLUMN IF NOT EXISTS ndis_reportable_override_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS ndis_reportable_override_at TIMESTAMPTZ;

COMMENT ON COLUMN public.incidents.identified_at IS
    'When occurred_at (incident_date) is unknown, this is required instead — per Commission guidance.';
COMMENT ON COLUMN public.incidents.witnesses_structured IS
    'Array of {name, contact, relationship}. Legacy free-text `witnesses` column kept for old rows.';
COMMENT ON COLUMN public.incidents.ndis_reportable_override IS
    'Coordinator correction to the auto-classified ndis_reportable value. The original engine
     output in ndis_reportable is never overwritten — this is the audit-preserving override.
     Set once via a dedicated endpoint requiring ndis_reportable_override_reason; not editable
     after that (matches the spec: "retained permanently on the record, not editable afterward").';

-- Subject of allegation: stored in a separate table with its own RLS, never joined into a
-- worker's own personnel/incident view — enforced at the schema level, not a UI convention.
CREATE TABLE IF NOT EXISTS public.incident_subject_of_allegation (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    organization_id   UUID NOT NULL,
    subject_type      TEXT NOT NULL CHECK (subject_type IN ('worker', 'participant', 'other')),
    subject_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    subject_name      TEXT,
    subject_role      TEXT,
    notes             TEXT,
    created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_subject_incident ON public.incident_subject_of_allegation(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_subject_org ON public.incident_subject_of_allegation(organization_id);

ALTER TABLE public.incident_subject_of_allegation ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incident_subject_of_allegation' AND policyname = 'incident_subject_service_role') THEN
        CREATE POLICY incident_subject_service_role ON public.incident_subject_of_allegation FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
