-- 262: Regular schedules (shift series).
--
-- A participant's standing arrangement, e.g. "Liam, Mon/Wed/Fri 9am to 12pm,
-- with Sam, every week, ongoing". The API keeps the shifts made a few weeks
-- ahead and tops them up as time passes, so regular support never quietly
-- runs out the way a fixed batch of recurring shifts did.
--
-- Each shift made from a series records it (series_id) and the day it was
-- made for (series_date). One shift per series per day, enforced here, so
-- two API servers topping up at the same moment can't double-book.
--
-- Only the API (service role) reads or writes shift_series: RLS is on with
-- no policies. The two new shifts columns are nullable and default to null,
-- so nothing existing changes. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.shift_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign key, like the other recent tables: organizations' key column
  -- isn't named the same on every database.
  organization_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  -- Null: the shifts are open shifts for someone to pick up.
  worker_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- 0 = Monday ... 6 = Sunday.
  days_of_week smallint[] NOT NULL CHECK (cardinality(days_of_week) > 0),
  -- Wall-clock times in the participant's branch. An end at or before the
  -- start runs past midnight.
  start_time time NOT NULL,
  end_time time NOT NULL,
  -- 1 every week, 2 every second week (counted from start_date's week).
  interval_weeks smallint NOT NULL DEFAULT 1 CHECK (interval_weeks BETWEEN 1 AND 4),
  start_date date NOT NULL,
  -- Null: ongoing. Before start_date: stopped before its first shift.
  end_date date,
  shift_type text NOT NULL DEFAULT 'standard_support',
  expected_price_item_code text,
  service_agreement_support_id uuid,
  selected_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The last day shifts have been made for.
  generated_through date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_series_participant_idx
  ON public.shift_series (organization_id, participant_id);
CREATE INDEX IF NOT EXISTS shift_series_worker_idx
  ON public.shift_series (organization_id, worker_id);
ALTER TABLE public.shift_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_series FROM anon, authenticated;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.shift_series(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS series_date date;
CREATE UNIQUE INDEX IF NOT EXISTS shifts_series_occurrence_idx
  ON public.shifts (series_id, series_date)
  WHERE series_id IS NOT NULL;
