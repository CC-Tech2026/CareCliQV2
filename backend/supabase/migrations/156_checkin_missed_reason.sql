-- Let a worker explain a missed compliance check-in during shift review before submission

BEGIN;

ALTER TABLE public.shift_scheduled_checkins
    ADD COLUMN IF NOT EXISTS missed_reason TEXT,
    ADD COLUMN IF NOT EXISTS missed_reason_submitted_at TIMESTAMPTZ;

COMMIT;
