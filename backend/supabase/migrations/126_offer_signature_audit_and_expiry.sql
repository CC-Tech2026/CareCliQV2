-- "From Offer to First Day at Work" (Aug 2026): the worker's signature
-- acceptance already records a name and timestamp (103); this adds the two
-- fields genuinely missing from that record — the IP address the acceptance
-- was made from, and a fingerprint of exactly which stored documents were
-- presented at the moment of signing — plus a terminal 'expired' status and
-- a reminder-sent stamp for the day-3/day-14 reminder-then-expire pass
-- (offer_letter_reminder_service.py).

BEGIN;

ALTER TABLE public.employee_onboarding
    ADD COLUMN IF NOT EXISTS worker_signed_ip INET,
    ADD COLUMN IF NOT EXISTS worker_signed_user_agent TEXT,
    ADD COLUMN IF NOT EXISTS worker_signed_document_version_hash TEXT,
    ADD COLUMN IF NOT EXISTS offer_reminder_sent_at TIMESTAMPTZ;

-- Find and drop the existing status CHECK constraint by introspection rather
-- than assuming its auto-generated name (see 113 for why).
DO $$
DECLARE
    existing_constraint TEXT;
BEGIN
    SELECT con.conname INTO existing_constraint
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'employee_onboarding'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    LIMIT 1;

    IF existing_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.employee_onboarding DROP CONSTRAINT %I', existing_constraint);
    END IF;
END $$;

ALTER TABLE public.employee_onboarding ADD CONSTRAINT employee_onboarding_status_check
    CHECK (status IN ('draft', 'awaiting_signatures', 'signed', 'invited', 'completed', 'expired'));

COMMIT;
