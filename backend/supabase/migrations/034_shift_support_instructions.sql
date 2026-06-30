-- CARECLIQV2-157 — Structured support instructions on shift snapshots

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS support_instructions JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.shifts.support_instructions IS
    'Category-based support instructions (mobility, transfers, meds, etc.) for MyShift detail.';

COMMIT;
