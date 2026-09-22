-- organizations.organization_name has drifted nullable on the live database
-- despite 001_core_tables.sql declaring it NOT NULL (same live/schema-file
-- drift already documented for this table's id/organization_id column
-- naming and its extra legacy `name` column — see 201_quill_addon_entitlement.sql
-- and stripe_service.py's org-creation comments). Re-enforces it.

BEGIN;

-- Backfill any row missing organization_name from the legacy `name` column
-- (falls back to a placeholder only if neither has a value), so the
-- NOT NULL constraint below can actually be added.
UPDATE public.organizations
SET organization_name = COALESCE(organization_name, name, 'Unnamed organisation')
WHERE organization_name IS NULL;

ALTER TABLE public.organizations
    ALTER COLUMN organization_name SET NOT NULL;

COMMIT;
