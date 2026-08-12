-- Medication Safety Addendum step 3: reuse the medication_documents chain-of-custody table for
-- the high-risk administration verification photo, rather than a parallel storage path. A
-- verification photo has nothing to OCR, so it needs its own document_type so the upload
-- flow can skip extraction, and extraction_status needs a value that isn't a stalled 'pending'
-- or a misleading 'failed' for a document that was never meant to be extracted.

BEGIN;

ALTER TABLE public.medication_documents
    DROP CONSTRAINT IF EXISTS medication_documents_document_type_check;
ALTER TABLE public.medication_documents
    ADD CONSTRAINT medication_documents_document_type_check
    CHECK (document_type IN (
        'prescription', 'medication_management_plan', 'gp_letter', 'pharmacy_authority',
        'verification_photo', 'other'
    ));

ALTER TABLE public.medication_documents
    DROP CONSTRAINT IF EXISTS medication_documents_extraction_status_check;
ALTER TABLE public.medication_documents
    ADD CONSTRAINT medication_documents_extraction_status_check
    CHECK (extraction_status IN ('pending', 'complete', 'failed', 'needs_review', 'not_applicable'));

COMMIT;
