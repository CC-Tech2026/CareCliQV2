-- 261: A shift can be several Employment Hero timesheet lines.
-- A shift with a sleepover goes to payroll as separate lines (active work,
-- the sleepover, call-outs, active work again), so the export remembers every
-- line it created, to check and remove them together. timesheet_id keeps the
-- first line, as before. Nothing existing changes. Safe to re-run.

ALTER TABLE public.employment_hero_timesheets
  ADD COLUMN IF NOT EXISTS timesheet_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
