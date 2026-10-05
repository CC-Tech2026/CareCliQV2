-- The Meet & Greet summary: what the participant and their family said,
-- by topic, every point tied to the transcript lines it came from, and the
-- supports they asked for, which draft the service agreement.
--
-- Kept on the onboarding record (and read from there once the participant
-- is active), not printed on the signed agreement. Shape, written by
-- meet_greet_summary_service:
--   {generated_at, generated_by, sources: [{id, speaker, text}],
--    topics: {goals|supports|schedule|preferences|access_and_risk|people|other: [{text, source_ids}]},
--    supports: [{description, item_code, hours_per_week, frequency, location, source_ids, unverified}],
--    uncovered: [{id, speaker, text, status: open|included|dismissed}],
--    dropped_points}
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.participant_intakes
    ADD COLUMN IF NOT EXISTS meet_greet_summary JSONB;

COMMENT ON COLUMN public.participant_intakes.meet_greet_summary IS
    'Meet & Greet summary by topic with transcript sources, drafted supports, and anything said that the summary does not cover. See migration 237.';

COMMIT;
