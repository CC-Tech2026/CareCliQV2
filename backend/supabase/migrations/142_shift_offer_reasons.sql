-- Lets a worker explain why they can't make a shift / are declining an
-- offer, so the coordinator sees more than just "unassigned" when they open
-- the reassignment panel.

BEGIN;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS cannot_attend_reason TEXT;
ALTER TABLE public.shift_offers ADD COLUMN IF NOT EXISTS decline_reason TEXT;

COMMIT;
