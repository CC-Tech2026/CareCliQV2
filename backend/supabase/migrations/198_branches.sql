-- Branches (offices) — the source of truth for timezones.
--
-- A provider can have offices in different states (Adelaide head office,
-- Melbourne branch). Staff and participants belong to a branch and never
-- cross states, so one timezone per branch covers everything that happens
-- there: shift times, SCHADS penalty boundaries, billing periods, plan
-- periods, notes, dashboards. The timezone is derived from the branch's
-- state (public.timezone_for_state) so it can't be typed wrong.
--
-- Every organisation gets exactly one head office. Existing orgs are
-- backfilled to Australia/Adelaide (what the app has always assumed);
-- new orgs get one automatically via trigger. Members and participants
-- inserted without a branch land in the org's head office via trigger,
-- so no existing insert path breaks when the columns become NOT NULL.

BEGIN;

-- ── State → IANA timezone ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.timezone_for_state(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE upper(trim(p_state))
        WHEN 'SA'  THEN 'Australia/Adelaide'
        WHEN 'NSW' THEN 'Australia/Sydney'
        WHEN 'ACT' THEN 'Australia/Sydney'
        WHEN 'VIC' THEN 'Australia/Melbourne'
        WHEN 'QLD' THEN 'Australia/Brisbane'
        WHEN 'WA'  THEN 'Australia/Perth'
        WHEN 'TAS' THEN 'Australia/Hobart'
        WHEN 'NT'  THEN 'Australia/Darwin'
    END
$$;

-- ── Table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.branches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    name            text NOT NULL,
    state           text NOT NULL
                    CHECK (state IN ('SA', 'NSW', 'VIC', 'QLD', 'WA', 'TAS', 'NT', 'ACT')),
    timezone        text NOT NULL
                    CHECK (timezone IN (
                        'Australia/Adelaide', 'Australia/Sydney', 'Australia/Melbourne',
                        'Australia/Brisbane', 'Australia/Perth', 'Australia/Hobart',
                        'Australia/Darwin'
                    )),
    is_head_office  boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

-- Exactly one head office per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_one_head_office
    ON public.branches (organization_id)
    WHERE is_head_office;

CREATE INDEX IF NOT EXISTS idx_branches_organization_id
    ON public.branches (organization_id);

-- Keep timezone in step with state on every write.
CREATE OR REPLACE FUNCTION public.branches_sync_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.state := upper(trim(NEW.state));
    NEW.timezone := public.timezone_for_state(NEW.state);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_sync_timezone ON public.branches;
CREATE TRIGGER trg_branches_sync_timezone
    BEFORE INSERT OR UPDATE ON public.branches
    FOR EACH ROW EXECUTE FUNCTION public.branches_sync_timezone();

-- ── Head office per organisation ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_head_office(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id
    FROM public.branches
    WHERE organization_id = p_org_id AND is_head_office
    LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO public.branches (organization_id, name, state, timezone, is_head_office)
        VALUES (p_org_id, 'Head Office', 'SA', 'Australia/Adelaide', true)
        ON CONFLICT (organization_id, name) DO UPDATE SET is_head_office = true
        RETURNING id INTO v_id;
    END IF;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.organizations_create_head_office()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.ensure_head_office(NEW.organization_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_create_head_office ON public.organizations;
CREATE TRIGGER trg_organizations_create_head_office
    AFTER INSERT ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.organizations_create_head_office();

-- Backfill: one Adelaide head office for every existing organisation.
INSERT INTO public.branches (organization_id, name, state, timezone, is_head_office)
SELECT o.organization_id, 'Head Office', 'SA', 'Australia/Adelaide', true
FROM public.organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.organization_id = o.organization_id AND b.is_head_office
);

-- ── branch_id on members and participants ───────────────────────────────

ALTER TABLE public.organization_members
    ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_organization_members_branch_id
    ON public.organization_members (branch_id);

CREATE INDEX IF NOT EXISTS idx_patients_branch_id
    ON public.patients (branch_id);

-- Default an unset branch to the org's head office. Covers every existing
-- insert path (signup, invites, seeds, participant creation) without each
-- one having to know about branches.
CREATE OR REPLACE FUNCTION public.default_branch_to_head_office()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.branch_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        NEW.branch_id := public.ensure_head_office(NEW.organization_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_members_default_branch ON public.organization_members;
CREATE TRIGGER trg_organization_members_default_branch
    BEFORE INSERT OR UPDATE OF branch_id, organization_id ON public.organization_members
    FOR EACH ROW EXECUTE FUNCTION public.default_branch_to_head_office();

DROP TRIGGER IF EXISTS trg_patients_default_branch ON public.patients;
CREATE TRIGGER trg_patients_default_branch
    BEFORE INSERT OR UPDATE OF branch_id, organization_id ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.default_branch_to_head_office();

-- A branch must belong to the same organisation as the row it's on.
CREATE OR REPLACE FUNCTION public.branch_matches_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.id = NEW.branch_id AND b.organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'branch % does not belong to organization %', NEW.branch_id, NEW.organization_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_members_branch_org ON public.organization_members;
CREATE TRIGGER trg_organization_members_branch_org
    BEFORE INSERT OR UPDATE OF branch_id, organization_id ON public.organization_members
    FOR EACH ROW EXECUTE FUNCTION public.branch_matches_organization();

DROP TRIGGER IF EXISTS trg_patients_branch_org ON public.patients;
CREATE TRIGGER trg_patients_branch_org
    BEFORE INSERT OR UPDATE OF branch_id, organization_id ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.branch_matches_organization();

-- Backfill existing rows, then require the column.
UPDATE public.organization_members m
SET branch_id = b.id
FROM public.branches b
WHERE b.organization_id = m.organization_id
  AND b.is_head_office
  AND m.branch_id IS NULL;

UPDATE public.patients p
SET branch_id = b.id
FROM public.branches b
WHERE b.organization_id = p.organization_id
  AND b.is_head_office
  AND p.branch_id IS NULL;

-- Rows with no organisation at all (shouldn't exist, but test data can be
-- messy) can't be given a branch; only enforce NOT NULL when clean.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE branch_id IS NULL) THEN
        ALTER TABLE public.organization_members ALTER COLUMN branch_id SET NOT NULL;
    ELSE
        RAISE WARNING 'organization_members.branch_id left nullable: rows without an organization exist';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.patients WHERE branch_id IS NULL) THEN
        ALTER TABLE public.patients ALTER COLUMN branch_id SET NOT NULL;
    ELSE
        RAISE WARNING 'patients.branch_id left nullable: rows without an organization exist';
    END IF;
END $$;

-- ── RLS / grants ────────────────────────────────────────────────────────

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'branches' AND policyname = 'branches_service_role'
    ) THEN
        CREATE POLICY branches_service_role
        ON public.branches
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Quill (read-only quill_agent role, 197_quill_agent_role.sql) needs the
-- branch timezone to show shift times in the right zone.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quill_agent') THEN
        GRANT SELECT ON public.branches TO quill_agent;
        GRANT SELECT (branch_id) ON public.organization_members TO quill_agent;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE tablename = 'branches' AND policyname = 'quill_agent_org_select'
        ) THEN
            CREATE POLICY quill_agent_org_select ON public.branches
                FOR SELECT TO quill_agent
                USING (organization_id = public.quill_jwt_org_id());
        END IF;
    END IF;
END $$;

COMMIT;
