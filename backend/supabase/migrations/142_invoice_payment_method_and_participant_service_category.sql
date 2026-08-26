-- Adds the two real fields the redesigned Monthly Finance Ledger needs that
-- didn't exist on either table yet:
--   - invoices.payment_method   — how the invoice was/will be paid
--   - patients.service_category — Aged Care vs Disability, at the participant
--     level (mirrors the same distinction already used in Participant
--     Onboarding's local intake flow, now made real for actual participants)

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_payment_method_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN (
    'bank_transfer', 'credit_card', 'direct_debit', 'ndis_portal', 'cash', 'other'
  ));

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS service_category text;

ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_service_category_check;

ALTER TABLE public.patients
  ADD CONSTRAINT patients_service_category_check
  CHECK (service_category IS NULL OR service_category IN ('aged_care', 'disability'));

CREATE INDEX IF NOT EXISTS idx_invoices_payment_method ON public.invoices(payment_method);
CREATE INDEX IF NOT EXISTS idx_patients_service_category ON public.patients(service_category);
