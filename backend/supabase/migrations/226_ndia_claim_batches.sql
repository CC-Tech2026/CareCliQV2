-- NDIA bulk claims.
--
-- NDIA-managed invoices were marked "sent" by hand, with the claim itself
-- keyed into the provider portal line by line. A claim batch groups the
-- invoices submitted together, keeps the bulk payment request file that was
-- generated for them, and lets the remittance be matched back to the batch.
--
-- Invoices keep their normal status (sent when claimed, paid when the NDIA
-- pays); claim_batch_id says which batch they went in.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ndia_claim_batches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    batch_number    TEXT        NOT NULL,
    created_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    invoice_count   INTEGER     NOT NULL CHECK (invoice_count > 0),
    line_count      INTEGER     NOT NULL CHECK (line_count > 0),
    total_cents     BIGINT      NOT NULL CHECK (total_cents >= 0),
    file_path       TEXT,
    file_name       TEXT,
    remittance_reference TEXT,
    paid_at         TIMESTAMPTZ,
    CONSTRAINT ndia_claim_batches_number UNIQUE (organization_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_ndia_claim_batches_org
    ON public.ndia_claim_batches (organization_id, created_at DESC);

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS claim_batch_id UUID REFERENCES public.ndia_claim_batches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS claim_submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_claim_batch
    ON public.invoices (claim_batch_id)
    WHERE claim_batch_id IS NOT NULL;

ALTER TABLE public.ndia_claim_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ndia_claim_batches'
          AND policyname = 'ndia_claim_batches_service_role'
    ) THEN
        CREATE POLICY ndia_claim_batches_service_role ON public.ndia_claim_batches
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ndia-claims', 'ndia-claims', false, 5242880, ARRAY['text/csv'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
