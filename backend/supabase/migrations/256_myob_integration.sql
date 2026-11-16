-- 256: MYOB integration (invoices and payments), alongside Xero (253).
--
-- A managing director connects the organisation's MYOB Business (AccountRight)
-- company file once. Approved CareCliQ invoices are created in MYOB as service
-- sales invoices (the payer as the customer, GST-free NDIS lines), and
-- invoices paid in MYOB are marked paid in CareCliQ.
--
-- An organisation uses Xero or MYOB, not both; the API enforces that.
--
-- myob_connections holds the OAuth tokens and which company file
-- (business_id) was chosen. Only the API (service role) reads or writes it:
-- RLS is on with no policies, and the tokens are stored encrypted when
-- PII_ENCRYPTION_KEY is set.
-- myob_oauth_states holds the one-time "state" for each Connect click.
-- myob_contacts remembers which MYOB customer each payer became.
-- invoices gains the MYOB invoice it became (MYOB numbers its own invoices
-- when CareCliQ's number is longer than MYOB's 13 characters) and how the
-- last sync went.
-- Everything is additive and safe to run again.

CREATE TABLE IF NOT EXISTS public.myob_connections (
  organization_id uuid PRIMARY KEY,
  business_id text NOT NULL,
  business_name text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scopes text,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  -- Income account, tax code, whether invoices go across when approved.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_payment_check_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.myob_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.myob_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.myob_oauth_states (
  state text PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.myob_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.myob_oauth_states FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.myob_contacts (
  organization_id uuid NOT NULL,
  -- The payer as CareCliQ knows them: "name:<lowercased name>".
  payer_key text NOT NULL,
  myob_customer_uid text NOT NULL,
  contact_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, payer_key)
);
ALTER TABLE public.myob_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.myob_contacts FROM anon, authenticated;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS myob_invoice_uid text,
  ADD COLUMN IF NOT EXISTS myob_invoice_number text,
  ADD COLUMN IF NOT EXISTS myob_status text,
  ADD COLUMN IF NOT EXISTS myob_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS myob_sync_error text;

CREATE INDEX IF NOT EXISTS invoices_myob_invoice_uid_idx
  ON public.invoices (organization_id, myob_invoice_uid)
  WHERE myob_invoice_uid IS NOT NULL;
