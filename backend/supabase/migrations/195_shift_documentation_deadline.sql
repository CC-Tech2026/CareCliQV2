-- A shift ended (by the worker's own force+reason override, or by the
-- overdue-shift auto-end backstop) with incomplete mandatory-task
-- documentation isn't a closed record - the worker still owes real
-- documentation, they just didn't finish it before ending the shift.
-- These columns track that: documentation_pending flags it, documentation_due_at
-- is 24h from clock-in (the actual start of the shift) to finish it, and
-- documentation_escalated_at (set once by overdue_documentation_escalation_service)
-- stops the same overdue shift from renotifying every pass forever.

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS documentation_pending BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS documentation_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS documentation_escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shifts_documentation_pending
    ON public.shifts (documentation_due_at)
    WHERE documentation_pending = true AND documentation_escalated_at IS NULL;

COMMIT;
