-- Remote e-signing of service agreements.
--
-- The provider signs first in CareCliQ, then the participant (or their
-- nominee / guardian) is emailed a single-use link. Before the agreement is
-- shown they confirm a 6-digit code sent to the same address; they then
-- type their name, draw a signature and confirm they understood it.
--
-- Only a SHA-256 of the link token is stored, so a database read can't be
-- turned into a working link. The signed PDF's hash is kept alongside the
-- signer's IP address and browser, as evidence of exactly what was signed.

BEGIN;

ALTER TABLE public.service_agreements
    ADD COLUMN IF NOT EXISTS sign_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS sign_token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signer_name TEXT,
    ADD COLUMN IF NOT EXISTS signer_email TEXT,
    ADD COLUMN IF NOT EXISTS signer_relationship TEXT
        CHECK (signer_relationship IS NULL OR signer_relationship IN ('participant', 'nominee', 'guardian', 'other')),
    ADD COLUMN IF NOT EXISTS signing_code_hash TEXT,
    ADD COLUMN IF NOT EXISTS signing_code_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signing_code_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS signing_code_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS signing_email_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS participant_signed_ip TEXT,
    ADD COLUMN IF NOT EXISTS participant_signed_user_agent TEXT,
    ADD COLUMN IF NOT EXISTS signed_document_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agreements_sign_token
    ON public.service_agreements (sign_token_hash)
    WHERE sign_token_hash IS NOT NULL;

COMMIT;
