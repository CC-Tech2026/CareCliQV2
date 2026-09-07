-- emergency_stop_shift() (backend/app/api/coordinator.py) has never
-- recorded which coordinator triggered it - "who did this" was
-- unanswerable. Named to match the table's existing emergency_flagged /
-- emergency_flagged_at columns, not a generic "stopped_by".
--
-- (The sibling POST /shifts/{id}/flag endpoint writes to alerts instead,
-- which already has a created_by column that was simply never populated -
-- no migration needed there, see app/api/coordinator.py's flag_shift_alert.)

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS emergency_flagged_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;
