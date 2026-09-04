-- The "invited" status (set the moment a login invite is sent, in
-- invitations.py's /create endpoint) had no timestamp of its own to measure
-- against — offer_letter_reminder_service.py's reminder/expiry pass only
-- ever looked at employer_signed_at and status='awaiting_signatures', so a
-- candidate sitting in "invited" (signed, invite sent, hasn't logged in
-- yet) got zero further reminders or escalation on either side. This adds
-- the tracking columns needed to close that gap with the same
-- remind-then-flag shape already used everywhere else in this pipeline.

BEGIN;

ALTER TABLE public.employee_onboarding
ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS invite_reminder_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS invite_expired_notified_at TIMESTAMPTZ;

COMMIT;
