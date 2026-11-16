-- Xero: how much of an invoice has been paid there, so CareCliQ can show
-- "Part paid: $500 of $1,324.44" instead of only paid / not paid.
-- Safe to run more than once.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS xero_amount_paid_cents integer,
  ADD COLUMN IF NOT EXISTS xero_amount_due_cents integer;

COMMENT ON COLUMN public.invoices.xero_amount_paid_cents IS
  'Amount paid against this invoice in Xero, in cents, as of xero_synced_at.';
COMMENT ON COLUMN public.invoices.xero_amount_due_cents IS
  'Amount still owing in Xero, in cents, as of xero_synced_at.';
