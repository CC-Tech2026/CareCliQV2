-- Email approved invoices to plan managers on their own.
--
-- organizations.auto_email_plan_managers: when on, approving an invoice for
-- a plan-managed participant emails it (with its PDF) to the plan manager on
-- the invoice straight away, the same email as pressing Email. Off by
-- default; the managing director or a billing coordinator turns it on in
-- Billing.
--
-- invoices.auto_email_error: why the automatic email didn't go (no email
-- address, email not set up, the send failed). The invoice then stays
-- approved and waiting to be sent, so it can be emailed by hand. Cleared
-- when it's sent.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS auto_email_plan_managers BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.auto_email_plan_managers IS
    'Email plan-managed invoices to the plan manager when approved. See migration 258.';

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS auto_email_error TEXT;

COMMENT ON COLUMN public.invoices.auto_email_error IS
    'Why the automatic plan manager email did not go; null once sent. See migration 258.';

COMMIT;
