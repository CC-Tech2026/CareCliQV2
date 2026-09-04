-- Adds org_events.start_time so the MD Calendar's Week/Day hour-grid can
-- position meetings (audit/training/meeting/review) at an exact time slot,
-- the same way appointments already are via shifts.scheduled_start.
-- Stored as "HH:MM" text (24h), nullable — existing rows created before this
-- migration have no time and keep showing in the calendar's all-day strip.

ALTER TABLE public.org_events
  ADD COLUMN IF NOT EXISTS start_time text;

ALTER TABLE public.org_events
  DROP CONSTRAINT IF EXISTS org_events_start_time_check;

ALTER TABLE public.org_events
  ADD CONSTRAINT org_events_start_time_check
  CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
