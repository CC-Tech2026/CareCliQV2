-- 266: travel claims carry their evidence.
--
-- A claim says what the trip was: where the worker went and why (required
-- when a car trip's distance differs from the route estimate). Car trips can
-- now have a photo too (odometer, parking or toll receipt), stored in the same
-- receipt_storage_path that fares already use.
--
-- Idempotent: safe to run again.

ALTER TABLE public.shift_travel_expenses
    ADD COLUMN IF NOT EXISTS trip_details TEXT;

COMMENT ON COLUMN public.shift_travel_expenses.trip_details IS
    'What the trip was, in the worker''s words: where they went and why. Required when a car trip''s claimed distance differs from the route estimate.';
