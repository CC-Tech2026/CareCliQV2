-- Offer/service-agreement documents contain sensitive content (salary, terms,
-- policies) and were reachable by anyone holding the sign_token link alone
-- (e.g. a forwarded or intercepted email) with no further proof of inbox
-- access. Same 6-digit email-code pattern already used for invitations
-- (invitations.email_code_hash/email_code_expires_at/email_verified_at),
-- mirrored here on employee_onboarding so the candidate has to prove they
-- own the inbox before the actual document contents/signing action unlock.

BEGIN;

ALTER TABLE public.employee_onboarding
ADD COLUMN IF NOT EXISTS signing_code_hash TEXT,
ADD COLUMN IF NOT EXISTS signing_code_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signing_code_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signing_email_verified_at TIMESTAMPTZ;

COMMIT;
