-- Renames participant_intakes' signed_document_* columns to
-- service_agreement_document_* — these columns exist for exactly one
-- purpose (the intake pipeline's "service agreement" stage, see
-- 207_participant_intakes.sql's `status` CHECK, which has a dedicated
-- 'signed' state and no other document type on this table), so the
-- generic "signed_document" name was vaguer than the schema actually is.
--
-- Every application-code caller (participant_intake_service.py,
-- service_agreement_service.py, participant_portal.py, and the frontend's
-- participantIntakeService.ts / onboard-participant.tsx) is updated in the
-- same change that ships this migration; both must land together.
--
-- Safe to re-run: each column is renamed only while its old name still
-- exists. The dev database had this applied by hand before
-- backend/scripts/migrate.py recorded it, so the deploy runner will run it
-- again there.

BEGIN;

DO $$
DECLARE
    suffix text;
BEGIN
    FOREACH suffix IN ARRAY ARRAY['path', 'url', 'name'] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'participant_intakes'
              AND column_name = 'signed_document_' || suffix
        ) THEN
            EXECUTE format(
                'ALTER TABLE public.participant_intakes RENAME COLUMN %I TO %I',
                'signed_document_' || suffix,
                'service_agreement_document_' || suffix
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
