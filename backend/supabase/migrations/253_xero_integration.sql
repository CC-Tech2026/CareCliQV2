-- 253: Xero integration (invoices and payments).
--
-- A managing director connects the organisation's Xero file once. Approved
-- CareCliQ invoices are created in Xero as sales invoices (the payer as the
-- contact, GST-free NDIS lines), and payments recorded in Xero mark the
-- CareCliQ invoice paid.
--
-- xero_connections holds the OAuth tokens. Only the API (service role) reads
-- or writes it: RLS is on with no policies, and the tokens are stored
-- encrypted when PII_ENCRYPTION_KEY is set.
-- xero_oauth_states holds the one-time "state" for each Connect click, so a
-- callback can only finish a connection its own organisation started.
-- xero_contacts remembers which Xero contact each payer became, so a plan
-- manager isn't created twice.
-- invoices gains the Xero invoice it became and how the last sync went.
-- Everything is additive; nothing existing changes.

CREATE TABLE IF NOT EXISTS public.xero_connections (
  organization_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  tenant_name text,
  xero_connection_id text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scopes text,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  -- Sales account, tax rate, whether invoices go across approved or as drafts.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_payment_check_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xero_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xero_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.xero_oauth_states (
  state text PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xero_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xero_oauth_states FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.xero_contacts (
  organization_id uuid NOT NULL,
  -- The payer as CareCliQ knows them: "name:<lowercased name>".
  payer_key text NOT NULL,
  xero_contact_id text NOT NULL,
  contact_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, payer_key)
);
ALTER TABLE public.xero_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xero_contacts FROM anon, authenticated;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS xero_invoice_id text,
  ADD COLUMN IF NOT EXISTS xero_status text,
  ADD COLUMN IF NOT EXISTS xero_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS xero_sync_error text;

CREATE INDEX IF NOT EXISTS invoices_xero_invoice_id_idx
  ON public.invoices (organization_id, xero_invoice_id)
  WHERE xero_invoice_id IS NOT NULL;
