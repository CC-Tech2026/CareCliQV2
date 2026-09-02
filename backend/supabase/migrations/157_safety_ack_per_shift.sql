-- Safety card acknowledgement must be given fresh on every clock-in, not reused
-- across shifts once acknowledged for a content version.

BEGIN;

ALTER TABLE public.worker_safety_acknowledgements
    ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_worker_safety_ack_shift
    ON public.worker_safety_acknowledgements (shift_id);

-- Old rows (from before per-shift acknowledgement existed) keep shift_id NULL;
-- a plain (non-partial) unique index is used deliberately - a partial index's
-- WHERE clause would need to be repeated on every upsert's ON CONFLICT target
-- for Postgres to pick it as the arbiter, which Supabase's on_conflict= param
-- can't express. NULLs never collide with each other under a plain unique
-- index, so old un-scoped rows are unaffected and only real
-- worker+participant+shift combinations are deduplicated going forward.
ALTER TABLE public.worker_safety_acknowledgements
    DROP CONSTRAINT IF EXISTS worker_safety_ack_unique;

CREATE UNIQUE INDEX IF NOT EXISTS worker_safety_ack_unique_per_shift
    ON public.worker_safety_acknowledgements (worker_id, participant_id, shift_id);

COMMIT;
