-- Incident Management spec — investigation workflow: assigned investigator with
-- conflict-of-interest gating, plus structured interview records.
--
-- Conflict-of-interest check itself lives in application code (incident_service.py
-- assign_investigator), not the DB, since it needs to cross-reference incidents.user_id,
-- incidents.created_by, and incident_subject_of_allegation.subject_user_id at assign time.
-- The DB just records who was assigned and by whom, mirroring the ndis_reportable_override
-- audit columns added in 107.

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS assigned_investigator_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_investigator_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assigned_investigator_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Structured interview records — same "add alongside" pattern as incident_subject_of_allegation (107).
CREATE TABLE IF NOT EXISTS public.incident_interviews (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id       UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    organization_id   UUID NOT NULL,
    interviewee_name  TEXT NOT NULL,
    interviewee_type  TEXT NOT NULL CHECK (interviewee_type IN ('worker', 'participant', 'witness', 'other')),
    interviewee_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    interviewed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes             TEXT,
    interviewed_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_interviews_incident ON public.incident_interviews(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_interviews_org ON public.incident_interviews(organization_id);

ALTER TABLE public.incident_interviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incident_interviews' AND policyname = 'incident_interviews_service_role') THEN
        CREATE POLICY incident_interviews_service_role ON public.incident_interviews FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
