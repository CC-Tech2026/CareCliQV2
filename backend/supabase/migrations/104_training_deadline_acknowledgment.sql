-- Mandatory training deadline + completion acknowledgment.
-- Assigned training gets a 7-day due date; workers must explicitly
-- acknowledge they completed the training before it's recorded.

BEGIN;

ALTER TABLE public.worker_training_recommendations
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

UPDATE public.worker_training_recommendations
    SET due_at = recommended_at + INTERVAL '7 days'
    WHERE due_at IS NULL;

ALTER TABLE public.worker_training_completions
    ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

UPDATE public.worker_training_completions
    SET acknowledged = true, acknowledged_at = created_at
    WHERE acknowledged = false;

CREATE INDEX IF NOT EXISTS idx_worker_training_recs_due
    ON public.worker_training_recommendations (due_at)
    WHERE dismissed_at IS NULL;

COMMIT;