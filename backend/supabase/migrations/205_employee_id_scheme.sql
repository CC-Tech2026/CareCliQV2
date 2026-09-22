-- Employee ID scheme: auto-generated human-readable staff IDs for
-- managing_director / support_coordinator / support_worker, formatted as
-- <ROLE PREFIX><3-digit seq><4-letter org abbreviation>, e.g. SW003HARV.
-- Generation logic lives in employee_id_service.py.

BEGIN;

-- ── 1. Org abbreviation — MD-chosen, globally unique, 4 uppercase letters ──
-- Nullable: existing orgs won't have one until their MD sets it (retrofit +
-- backfill flow); new orgs collect it at signup, before any staff exist.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS org_abbrev text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_org_abbrev_format_check'
    ) THEN
        ALTER TABLE public.organizations
        ADD CONSTRAINT organizations_org_abbrev_format_check
        CHECK (org_abbrev IS NULL OR org_abbrev ~ '^[A-Z]{4}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_org_abbrev_unique'
    ) THEN
        ALTER TABLE public.organizations
        ADD CONSTRAINT organizations_org_abbrev_unique UNIQUE (org_abbrev);
    END IF;
END $$;

-- ── 2. Per-(org, role) sequence counter — never reused, even if a staff
--    member is later deactivated. Seeded implicitly: the first call for a
--    given pair inserts it starting at 1.

CREATE TABLE IF NOT EXISTS public.employee_id_counters (
    organization_id uuid NOT NULL,
    role text NOT NULL,
    next_seq integer NOT NULL DEFAULT 1,
    PRIMARY KEY (organization_id, role)
);

-- ── 3. Atomic "give me the next sequence number" function. Mirrors
--    increment_invoice_sequence (080_invoice_provider_details.sql) but
--    operates entirely on employee_id_counters, not organizations, so it
--    isn't affected by the organizations.id/organization_id PostgREST quirk
--    documented in organization_branding_service.py.

CREATE OR REPLACE FUNCTION public.next_employee_seq(p_organization_id UUID, p_role TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _new_seq INTEGER;
BEGIN
    INSERT INTO public.employee_id_counters (organization_id, role, next_seq)
    VALUES (p_organization_id, p_role, 2)
    ON CONFLICT (organization_id, role)
    DO UPDATE SET next_seq = employee_id_counters.next_seq + 1
    RETURNING next_seq - 1 INTO _new_seq;

    RETURN _new_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_employee_seq(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_employee_seq(UUID, TEXT) TO service_role;

-- ── 4. employee_id itself — already exists as free text
--    (038_worker_profile_account.sql), never written to until now. Add a
--    uniqueness backstop now that something actually populates it.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_employee_id_unique'
    ) THEN
        ALTER TABLE public.organization_members
        ADD CONSTRAINT organization_members_employee_id_unique UNIQUE (employee_id);
    END IF;
END $$;

COMMIT;
