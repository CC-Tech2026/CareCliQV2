-- Worker financial details: bank, super and tax details captured once during
-- onboarding. Structurally different from a credential (no file, no expiry,
-- no review/verification concept) so this is its own table rather than
-- shoehorned into public.credentials.
--
-- bank_account_number and tax_file_number are encrypted at the application
-- layer via backend/app/services/pii_service.py (AES-256-GCM, ENC: prefix)
-- before being written here, when PII_ENCRYPTION_ENABLED=true. Columns stay
-- TEXT to hold either plaintext or the ENC:-prefixed ciphertext depending on
-- that flag, same pattern the pii_service module already assumes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_financial_details (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id             UUID        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id       UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    bank_account_name     TEXT,
    bank_bsb              TEXT,
    bank_account_number   TEXT,
    super_fund_name       TEXT,
    super_member_number   TEXT,
    tax_file_number       TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_financial_details_org
    ON public.worker_financial_details (organization_id);

ALTER TABLE public.worker_financial_details ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'worker_financial_details'
        AND policyname = 'worker_financial_details_service_role'
    ) THEN
        CREATE POLICY worker_financial_details_service_role
        ON public.worker_financial_details
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;
