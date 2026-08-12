-- Medication Safety Addendum step 1: administration_error as its own outcome, distinct from
-- the six timing/compliance outcomes already defined. An error is not a timing variance —
-- keeping it in its own outcome value means it can never be undercounted by folding into a
-- general "missed or refused" statistic.
--
-- Immediate self-report: worker picks "administration_error" as the action directly, same tap
-- as refused/missed/withheld -- one row, corrects_administration_id stays null.
-- Later discovery by someone else: a new row referencing the original via
-- corrects_administration_id, exactly like every other correction on this ledger. The
-- immutability trigger (medication_administrations_no_update) already blocks in-place edits to
-- outcome/administered_by/etc, so error_discovered_at/by are only ever populated on that new
-- correction row, never written onto the original.

BEGIN;

ALTER TABLE public.medication_administrations
    DROP CONSTRAINT IF EXISTS medication_administrations_outcome_check;
ALTER TABLE public.medication_administrations
    ADD CONSTRAINT medication_administrations_outcome_check
    CHECK (outcome IN (
        'given_on_time', 'given_late', 'given_early',
        'refused', 'missed', 'withheld', 'administration_error'
    ));

ALTER TABLE public.medication_administrations
    ADD COLUMN IF NOT EXISTS error_subtype TEXT
        CHECK (error_subtype IN ('wrong_medication', 'wrong_dose', 'wrong_participant', 'wrong_route', 'other')),
    ADD COLUMN IF NOT EXISTS error_discovered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error_discovered_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;
