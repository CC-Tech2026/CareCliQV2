-- Medication Management v2 step 1: document chain of custody.
--
-- The original uploaded file (prescription, medication management plan, GP letter) is now
-- stored permanently, before extraction runs — extraction failing, being slow, or returning a
-- poor result is never a reason the original document was not saved. Extraction populates
-- extracted_data as a *proposal*; nothing here writes to public.medications directly.
--
-- Versioning: effective_from / superseded_at (not just a superseded_by pointer) so "what was
-- the authorization on file on this date" is a plain range query, matching the pattern already
-- used for NDIS pricing (025_ndis_pricing_effective_dated.sql) rather than requiring a chain walk.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'medication-documents',
    'medication-documents',
    true,
    15728640,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'medication_documents_storage_service_all'
    ) THEN
        CREATE POLICY medication_documents_storage_service_all
        ON storage.objects
        FOR ALL TO service_role
        USING (bucket_id = 'medication-documents')
        WITH CHECK (bucket_id = 'medication-documents');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.medication_documents (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id              UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL,
    medication_id               UUID REFERENCES public.medications(id) ON DELETE SET NULL,
    file_path                   TEXT NOT NULL,
    file_url                    TEXT NOT NULL,
    file_name                   TEXT NOT NULL,
    file_type                   TEXT NOT NULL,
    file_size                   INTEGER NOT NULL,
    document_type               TEXT NOT NULL DEFAULT 'other'
                                CHECK (document_type IN ('prescription', 'medication_management_plan', 'gp_letter', 'pharmacy_authority', 'other')),
    extracted_data              JSONB,
    extraction_status           TEXT NOT NULL DEFAULT 'pending'
                                CHECK (extraction_status IN ('pending', 'complete', 'failed', 'needs_review')),
    uploaded_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_from              TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_by_document_id   UUID REFERENCES public.medication_documents(id) ON DELETE SET NULL,
    superseded_at               TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_documents_participant ON public.medication_documents(participant_id);
CREATE INDEX IF NOT EXISTS idx_medication_documents_medication ON public.medication_documents(medication_id);
CREATE INDEX IF NOT EXISTS idx_medication_documents_org ON public.medication_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_medication_documents_current
    ON public.medication_documents(medication_id, effective_from DESC)
    WHERE superseded_at IS NULL;

ALTER TABLE public.medication_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medication_documents' AND policyname = 'medication_documents_service_role') THEN
        CREATE POLICY medication_documents_service_role ON public.medication_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;

-- Make the bucket private (public = false) and use signed URLs.

BEGIN;

UPDATE storage.buckets
SET public = false
WHERE id = 'medication-documents';

COMMIT;