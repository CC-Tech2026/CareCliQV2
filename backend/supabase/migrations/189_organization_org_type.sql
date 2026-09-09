-- Which service(s) a provider organisation delivers — Aged Care, Disability,
-- or both. Shown/edited as "Org Type" in the Super Admin Providers list
-- (backend/app/api/admin.py, artifacts/frontend/src/pages/admin/providers.tsx).
--
-- Deliberately a new, separate column rather than reusing provider_type:
-- provider_type is NDIS *registration* status (Registered NDIS Provider,
-- Support Coordination Provider, etc. — set at signup, see signup.tsx),
-- an entirely different concept from which service(s) a provider offers.
-- Nullable — no existing organisation has this set; a Super Admin sets it
-- per-org from the Providers list until/unless it's ever added to signup.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS org_type TEXT
    CHECK (org_type IN ('aged_care', 'disability', 'aged_care_disability'));

COMMENT ON COLUMN public.organizations.org_type IS
    'Which service(s) this provider delivers — aged_care, disability, or aged_care_disability. Not the same as provider_type (NDIS registration status).';

COMMIT;
