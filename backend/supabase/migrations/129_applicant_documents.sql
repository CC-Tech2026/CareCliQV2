-- Applicant documents (resume/CV, cover letter, ID, other) — uploaded when a
-- candidate is added to the Applicants Board, before any offer exists. Kept
-- separate from employee_onboarding_documents/worker_onboarding_documents
-- (both post-offer/post-hire paperwork) since these are the candidate's own
-- intake files, and stay attached to the applicant record so they're still
-- reachable later (e.g. resume-driven skill extraction) even after the
-- candidate is hired.

BEGIN;

CREATE TABLE IF NOT EXISTS public.applicant_documents (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_id     UUID        NOT NULL REFERENCES public.applicants(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    document_type    TEXT        NOT NULL DEFAULT 'resume'
                     CHECK (document_type IN ('resume', 'cover_letter', 'id_document', 'other')),
    title            TEXT        NOT NULL,
    notes            TEXT,
    file_path        TEXT,
    file_url         TEXT,
    uploaded_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicant_documents_applicant
    ON public.applicant_documents (applicant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_applicant_documents_org
    ON public.applicant_documents (organization_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'applicant-files',
    'applicant-files',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.applicant_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'applicant_documents'
        AND policyname = 'applicant_documents_service_role'
    ) THEN
        CREATE POLICY applicant_documents_service_role
        ON public.applicant_documents
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;