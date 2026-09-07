-- Every NDIS incident is about a participant's safety, so an incident
-- record with no participant link is not traceable to the person it
-- concerns. session_id and shift_id stay optional - not every incident
-- happens during an active session or shift.
--
-- Verified live before this migration was written: 6 pre-existing rows
-- had a null participant_id (4 identical duplicate test submissions, 2
-- garbled dev/QA entries) - confirmed as test data and deleted, not
-- backfilled with a guess. Zero live rows violate this constraint as of
-- the migration being written.

BEGIN;

ALTER TABLE public.incidents
    ALTER COLUMN participant_id SET NOT NULL;

COMMIT;
