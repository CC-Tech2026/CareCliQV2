-- Deactivate vs delete, properly differentiated (CareCliQ, Aug 2026):
-- deactivate is reversible and keeps the worker able to log in to a locked-
-- down portal; delete queues permanent removal (see privacy_service.py's
-- account_deletion_requests, unchanged here). Deactivation previously had no
-- record of *why* - this adds it, so the worker's locked-down portal can
-- show them a real reason and, for self-fixable reasons, keep the one page
-- that resolves it unlocked while everything else (shifts, etc.) is locked.

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deactivation_note TEXT;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_deactivation_reason_check'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT users_deactivation_reason_check
            CHECK (deactivation_reason IN ('credentials', 'training', 'credentials_training', 'manual') OR deactivation_reason IS NULL);
    END IF;
END $$;

COMMENT ON COLUMN public.users.deactivation_reason IS
    'Why is_active was set false. credentials/training/credentials_training are self-fixable - the worker keeps portal access to that one page (My Onboarding / Training) to resolve it, everything else locked. manual (performance, conduct, etc.) has no self-service path - the worker sees a fully locked account screen pointing them to their organisation admin. NULL for accounts never deactivated, or cleared back to NULL on reactivation.';
COMMENT ON COLUMN public.users.deactivated_by IS
    'Who deactivated this account - NULL means the system did it automatically (see onboarding_escalation_service.py''s 14-day auto-inactive pass), otherwise the coordinator/MD user id.';

COMMIT;
