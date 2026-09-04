-- Super Admin Portal: lets CareCliQ (the vendor) suspend/reactivate a
-- provider organisation. No such mechanism existed before this — a provider
-- could not be locked out of the system at all.
--   - active     — normal use (default; every existing org starts here)
--   - suspended  — locked out (e.g. non-payment); login blocked, all live
--     sessions revoked when this is set (see revoke_all_sessions_for_org)
--   - offboarded — no longer a customer, kept for record-keeping

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'suspended', 'offboarded'));

CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations(status);
