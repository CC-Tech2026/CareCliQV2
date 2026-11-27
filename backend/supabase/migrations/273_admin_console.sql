-- ============================================================
-- Admin console: free access and staff held for the MD
-- ============================================================
-- CareCliQ's super admins look after each provider's account from the
-- admin portal (backend/app/api/admin.py). Two things they need that the
-- schema didn't have:
--
-- 1. Free access until a date. A super admin can keep an organisation
--    fully working (pilot, a billing mix-up being sorted, a goodwill
--    extension) whatever its Stripe status says. While
--    access_override_until is in the future, subscription_access.py treats
--    the organisation as fully paid up. Nothing is changed in Stripe.
--
-- 2. Staff imported by CareCliQ on the provider's behalf. When we bring a
--    provider's team across from their old system, the invitations wait
--    here until the provider's managing director chooses to send them
--    (data_import.py, /held-staff). They are not invitations yet: no token
--    or short code exists, so nobody can accept one before the MD sends it.
--
-- No foreign key to organizations (its key column differs between
-- databases; see migration 262). Safe to run more than once.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS access_override_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS access_override_reason TEXT;

COMMENT ON COLUMN public.organizations.access_override_until IS
    'Set by a CareCliQ super admin: until this time the organisation has full access whatever its subscription status. NULL = no override.';
COMMENT ON COLUMN public.organizations.access_override_reason IS
    'Why the super admin granted free access (shown in the admin portal).';

CREATE TABLE IF NOT EXISTS public.held_staff_invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    email           text NOT NULL,
    full_name       text,
    role            text NOT NULL DEFAULT 'support_worker'
                    CHECK (role IN ('support_worker', 'support_coordinator')),
    source_system   text,
    prepared_by     uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS held_staff_invitations_org_email
    ON public.held_staff_invitations (organization_id, lower(email));

-- The API reads and writes this table with the service role only.
ALTER TABLE public.held_staff_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.held_staff_invitations FROM anon, authenticated;
