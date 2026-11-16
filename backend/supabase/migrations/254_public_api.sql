-- 254: CareCliQ API for other systems (API keys and webhooks).
--
-- A managing director creates API keys (Settings > Integrations > API and
-- webhooks) for systems such as CORA Workforce. A key reads its own
-- organisation's data through /api/v1 and nothing else. Only a SHA-256
-- fingerprint of each key is stored; the key itself is shown once, when it's
-- made. Revoking is immediate.
--
-- Webhook endpoints receive signed POSTs when things change (a credential is
-- added or updated, training is completed, a worker joins or leaves). Each
-- attempt is kept in webhook_deliveries so failures can be retried and seen.
-- Signing secrets are stored encrypted when PII_ENCRYPTION_KEY is set.
--
-- Only the API (service role) reads or writes these tables: RLS is on with no
-- policies. Everything is new; nothing existing changes.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  -- The start of the key ("cc_live_ab12cd34"), so people can tell keys apart.
  key_prefix text NOT NULL,
  -- SHA-256 of the whole key, hex.
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['workers:read', 'credentials:read', 'training:read'],
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (organization_id);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_keys FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  url text NOT NULL,
  description text,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  last_status_code integer,
  -- Failed deliveries in a row; reset by a success.
  failure_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_org_idx ON public.webhook_endpoints (organization_id);
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_endpoints FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  -- The same for every endpoint the event went to, so receivers can de-duplicate.
  event_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  response_status integer,
  response_body text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON public.webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON public.webhook_deliveries (endpoint_id, created_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM anon, authenticated;
