-- Records why a shift was cancelled, distinct from the bare status flip.
-- Immediate driver: unassigned_shift_expiry_service.py auto-cancels a shift
-- that passed its scheduled start with no worker ever assigned, rather than
-- leaving it invisible and unaccounted for (NDIS Practice Standards require
-- accurate records of support that was and wasn't delivered, and why - a
-- status of 'cancelled' alone doesn't say why). No new status value and no
-- change to the existing CHECK constraint - this only adds the "why".

BEGIN;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN public.shifts.cancellation_reason IS
    'Why a cancelled shift was cancelled - e.g. unassigned_shift_expired (system auto-cancel, see unassigned_shift_expiry_service.py) vs a coordinator-entered reason. NULL for shifts cancelled before this column existed, and for shifts that are not cancelled.';

COMMIT;
