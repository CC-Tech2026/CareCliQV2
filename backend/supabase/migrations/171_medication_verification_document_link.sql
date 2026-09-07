-- The high-risk medication administration gate (medication_service.py) has, until now, only
-- ever checked that medication_administrations.verification_photo_url was a non-empty string —
-- it never confirmed that URL actually corresponded to a real uploaded file. The photo upload
-- endpoint (worker.py: POST .../medications/{id}/verification-photo) stores the file as a real
-- medication_documents row and returns its file_url; the administration POST then receives that
-- same URL back as plain text. The two rows are connected only because the URL values happen to
-- match — there has never been a foreign key from one to the other.
--
-- Orphan-check discipline (as in 084/085/086_reconcile_duplicate_data.sql): report mismatches
-- before deciding what to enforce, not after. This migration cannot be pre-run against the live
-- database from the environment that authored it — no live Supabase credentials are available
-- there (.env in that environment holds only placeholder values). The DO block below runs the
-- audit itself, at apply time, and RAISEs the findings into the migration run's own output —
-- read that output before deciding whether a NOT NULL constraint is ever appropriate here. This
-- migration does not add one.

BEGIN;

ALTER TABLE public.medication_administrations
    ADD COLUMN IF NOT EXISTS verification_document_id UUID
        REFERENCES public.medication_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_medication_admin_verification_document
    ON public.medication_administrations(verification_document_id);

-- Backfill: link every existing administration to the medication_documents row whose file_url
-- matches, for the same medication (this is the strict, safe match — organization_id is
-- implied by medication_id, and only the URL is otherwise available). No FK constraint below
-- forces a match; rows that don't backfill simply keep verification_document_id NULL.
UPDATE public.medication_administrations ma
SET verification_document_id = md.id
FROM public.medication_documents md
WHERE ma.verification_document_id IS NULL
  AND ma.verification_photo_url IS NOT NULL
  AND ma.verification_photo_url = md.file_url
  AND ma.medication_id = md.medication_id;

-- Live audit: how many pre-existing verification_photo_url values could NOT be matched to a
-- real medication_documents row. Surfaced as NOTICE output on this migration's own run — this
-- is the finding to report before any follow-up decides whether to tighten this further.
DO $$
DECLARE
    unmatched_count INTEGER;
    total_with_url INTEGER;
BEGIN
    SELECT count(*) INTO total_with_url
    FROM public.medication_administrations
    WHERE verification_photo_url IS NOT NULL;

    SELECT count(*) INTO unmatched_count
    FROM public.medication_administrations
    WHERE verification_photo_url IS NOT NULL
      AND verification_document_id IS NULL;

    RAISE NOTICE 'medication_administrations verification_photo_url audit: % of % rows with a photo URL could not be linked to a medication_documents row by URL match.',
        unmatched_count, total_with_url;
END $$;

COMMIT;
