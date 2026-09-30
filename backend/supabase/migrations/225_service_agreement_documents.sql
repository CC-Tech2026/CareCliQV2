-- Generated NDIS service agreements: draft -> ready for signature -> signed.
--
-- 217 created service_agreements as the record of what a participant agreed
-- to, but nothing in the app wrote to it: agreements signed during
-- onboarding only existed as a PDF on the intake. This adds what's needed to
-- build the agreement in CareCliQ and sign it:
--
--   agreement_number        SA-2026-0148, unique per organisation
--   sent_at                 when it was marked ready for signature
--   provider_/participant_  who signed, when, and the drawn signature
--   signed_*
--   document_bucket/_path   the stored PDF (the signed copy once signed;
--                           for onboarding agreements, the intake's PDF)
--   intake_id               the onboarding record it came from, if any
--
-- Support lines get the quantity, unit and rate that appear on the document,
-- so a transport line reads "156 trips" rather than being forced into hours.
-- `rate` is the rate agreed on this document; `negotiated_rate` keeps its
-- 217 meaning (an org-wide price override).

BEGIN;

ALTER TABLE public.service_agreements
    ADD COLUMN IF NOT EXISTS agreement_number TEXT,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provider_signed_name TEXT,
    ADD COLUMN IF NOT EXISTS provider_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provider_signature_png TEXT,
    ADD COLUMN IF NOT EXISTS participant_signed_name TEXT,
    ADD COLUMN IF NOT EXISTS participant_signed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS participant_signature_png TEXT,
    ADD COLUMN IF NOT EXISTS document_bucket TEXT,
    ADD COLUMN IF NOT EXISTS document_path TEXT,
    ADD COLUMN IF NOT EXISTS intake_id UUID REFERENCES public.participant_intakes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agreements_number
    ON public.service_agreements (organization_id, agreement_number)
    WHERE agreement_number IS NOT NULL;

-- One agreement per onboarding record, so re-activating can't duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agreements_intake
    ON public.service_agreements (intake_id)
    WHERE intake_id IS NOT NULL;

ALTER TABLE public.service_agreement_supports
    ADD COLUMN IF NOT EXISTS quantity NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS unit TEXT,
    ADD COLUMN IF NOT EXISTS rate NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS item_name TEXT,
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'service_agreement_supports_quantity_positive'
    ) THEN
        ALTER TABLE public.service_agreement_supports
            ADD CONSTRAINT service_agreement_supports_quantity_positive
            CHECK (quantity IS NULL OR quantity > 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'service_agreement_supports_rate_non_negative'
    ) THEN
        ALTER TABLE public.service_agreement_supports
            ADD CONSTRAINT service_agreement_supports_rate_non_negative
            CHECK (rate IS NULL OR rate >= 0);
    END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('service-agreements', 'service-agreements', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.service_agreements IS
    'One row per NDIS service agreement: built and signed in CareCliQ, or recorded from onboarding. Source of record for plan management type, agreed supports and rates, and the price-adjustment/GST/cancellation terms.';

COMMIT;
