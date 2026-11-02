-- The managing director's participant profile: ending services, and the
-- participant's own documents (GP letters, clinical assessments, behaviour
-- support plans and the like).
--
-- 1. participant_intakes gains an 'exited' status, for a participant whose
--    services have ended for good. Suspension ('inactive') stays the
--    temporary pause it was. exit_reason, exited_at and last_service_date
--    record why and when.
-- 2. participant_documents holds files the provider receives about a
--    participant. Medication paperwork keeps going to medication_documents
--    (112), where it can be read into the medication chart; this table is for
--    everything else. Rows are archived, never deleted: clinical records are
--    kept for the retention period.

BEGIN;

DO $$
DECLARE
    con text;
BEGIN
    FOR con IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.participant_intakes'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
          AND pg_get_constraintdef(oid) ILIKE '%withdrawn%'
    LOOP
        EXECUTE format('ALTER TABLE public.participant_intakes DROP CONSTRAINT %I', con);
    END LOOP;
END $$;

ALTER TABLE public.participant_intakes
    ADD CONSTRAINT participant_intakes_status_check
    CHECK (status IN (
        'enquiry', 'screening', 'declined', 'withdrawn', 'meet_greet',
        'awaiting_signatures', 'signed', 'active', 'inactive', 'exited'
    ));

ALTER TABLE public.participant_intakes
    ADD COLUMN IF NOT EXISTS exit_reason       TEXT,
    ADD COLUMN IF NOT EXISTS exited_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_service_date DATE;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'participant-documents',
    'participant-documents',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'participant_documents_storage_service_all'
    ) THEN
        CREATE POLICY participant_documents_storage_service_all
        ON storage.objects FOR ALL TO service_role
        USING (bucket_id = 'participant-documents')
        WITH CHECK (bucket_id = 'participant-documents');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.participant_documents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    participant_id   UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    category         TEXT NOT NULL DEFAULT 'other'
                     CHECK (category IN (
                         'gp_letter', 'clinical_assessment', 'behaviour_support_plan',
                         'risk_assessment', 'hospital_discharge', 'therapy_report',
                         'ndis_plan', 'consent', 'other'
                     )),
    title            TEXT NOT NULL,
    document_date    DATE,
    author           TEXT,
    notes            TEXT,
    file_path        TEXT NOT NULL,
    file_name        TEXT NOT NULL,
    file_type        TEXT NOT NULL,
    file_size        INTEGER NOT NULL,
    uploaded_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at      TIMESTAMPTZ,
    archived_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    archive_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_participant_documents_participant
    ON public.participant_documents (participant_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_participant_documents_org
    ON public.participant_documents (organization_id);

ALTER TABLE public.participant_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.participant_documents FROM anon, authenticated;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'participant_documents' AND policyname = 'participant_documents_service_role') THEN
        CREATE POLICY participant_documents_service_role ON public.participant_documents
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
