-- Participants brought across from another system.
--
-- A provider moving to CareCliQ can import their existing participants from
-- a CSV export (data_import_service.py). They land on the onboarding board
-- like any new participant, so their service agreement is signed before
-- they're rostered, but marked as imported rather than as a referral.

ALTER TABLE public.participant_intakes
    DROP CONSTRAINT IF EXISTS participant_intakes_source_check;

ALTER TABLE public.participant_intakes
    ADD CONSTRAINT participant_intakes_source_check
    CHECK (source IN ('online_form', 'email', 'phone_call', 'coordinator_referral', 'import'));
