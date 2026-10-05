-- A service agreement can be built and signed during participant onboarding,
-- before the participant record exists.
--
-- Onboarding can't make someone active until their service agreement, with
-- its schedule of supports, is signed. The agreement is built against the
-- intake (service_agreements.intake_id, added in 225), and activation moves
-- it onto the new participant. Until then participant_id is empty, so it
-- can no longer be NOT NULL; every agreement still belongs to a participant
-- or an intake.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.service_agreements
    ALTER COLUMN participant_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'service_agreements_participant_or_intake'
    ) THEN
        ALTER TABLE public.service_agreements
            ADD CONSTRAINT service_agreements_participant_or_intake
            CHECK (participant_id IS NOT NULL OR intake_id IS NOT NULL);
    END IF;
END $$;

COMMENT ON COLUMN public.service_agreements.participant_id IS
    'The participant this agreement is with. Empty only while it belongs to an onboarding intake (intake_id); activation fills it in.';

COMMIT;
