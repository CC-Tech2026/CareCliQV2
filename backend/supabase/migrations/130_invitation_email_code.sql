-- Email one-time-code verification for the invite-accept flow. The invite
-- link email already proves someone had access to the inbox when it was
-- sent; this adds a second, in-the-moment check — a 6-digit code emailed
-- when the invitee actually opens the accept-invite page — before they're
-- allowed to set a password, without changing the underlying link-based
-- invite mechanism itself.

BEGIN;

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS email_code_hash TEXT,
    ADD COLUMN IF NOT EXISTS email_code_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_code_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMIT;