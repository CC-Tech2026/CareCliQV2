-- Migration 077: Make worker_id nullable for unassigned shifts
-- This allows creating shifts without assigning a worker upfront.
-- The create_unassigned_shift endpoint needs this to support the "unassigned" shift status.

BEGIN;

-- Make worker_id nullable
ALTER TABLE public.shifts
ALTER COLUMN worker_id DROP NOT NULL;

-- Update the column comment
COMMENT ON COLUMN public.shifts.worker_id IS 'The assigned worker; NULL for unassigned shifts';

COMMIT;
