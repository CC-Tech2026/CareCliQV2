-- Keep the signature with onboarding documents after a hire completes.
--
-- An offer letter / employment agreement is signed on employee_onboarding
-- (worker_signed_at), then migrate_documents_to_worker() copies the files to
-- worker_onboarding_documents — and until now dropped the link, so the
-- vault could only say "on file", never "signed".
--
-- The copy keeps file_path, which is unique per upload, so existing rows are
-- matched back to their hire exactly; rows uploaded straight onto a worker's
-- profile have no signing record and stay unsigned.

BEGIN;

ALTER TABLE public.worker_onboarding_documents
    ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES public.employee_onboarding(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

UPDATE public.worker_onboarding_documents w
SET onboarding_id = d.onboarding_id,
    signed_at = eo.worker_signed_at
FROM public.employee_onboarding_documents d
JOIN public.employee_onboarding eo ON eo.id = d.onboarding_id
WHERE w.onboarding_id IS NULL
  AND w.file_path IS NOT NULL
  AND d.file_path = w.file_path
  AND eo.organization_id = w.organization_id;

COMMENT ON COLUMN public.worker_onboarding_documents.signed_at IS
    'When the worker accepted/signed this document through the hiring flow. NULL for documents uploaded directly.';

COMMIT;
