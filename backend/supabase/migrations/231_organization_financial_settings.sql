-- Financial Governance: the figures CareCliQ can't know by itself.
--
-- Revenue comes from invoices and wages from the pay engine, but cash in
-- the bank and running costs outside payroll (rent, insurance, software,
-- vehicles) live in the accounting system. The managing director enters
-- them here so the page can show net profit and cash runway. They are
-- shown as entered, with the date the cash balance was taken.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_financial_settings (
    organization_id          UUID        PRIMARY KEY REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    cash_on_hand_cents       BIGINT      CHECK (cash_on_hand_cents IS NULL OR cash_on_hand_cents >= 0),
    cash_as_of               DATE,
    monthly_overheads_cents  BIGINT      CHECK (monthly_overheads_cents IS NULL OR monthly_overheads_cents >= 0),
    updated_by               UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read and written by the API with the service role only.
ALTER TABLE public.organization_financial_settings ENABLE ROW LEVEL SECURITY;

COMMIT;
