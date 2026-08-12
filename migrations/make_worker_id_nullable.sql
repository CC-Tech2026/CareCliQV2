-- Migration: Make worker_id nullable for unassigned shifts
-- This allows the system to create shifts without assigning a worker upfront

BEGIN;

-- Modify the shifts table to make worker_id nullable
ALTER TABLE public.shifts
ALTER COLUMN worker_id DROP NOT NULL;

-- Update the description/comment if needed
COMMENT ON COLUMN public.shifts.worker_id IS 'ID of the assigned worker; can be NULL for unassigned shifts';

COMMIT;
