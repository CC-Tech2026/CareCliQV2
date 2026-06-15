-- ============================================================
-- CareScribe — Missing Tables Patch
-- Run this in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/_/sql/new
-- All statements are idempotent (safe to run multiple times).
-- ============================================================

-- 1. ORGANIZATIONS
CREATE TABLE IF NOT EXISTS public.organizations (
    id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_user_id       UUID        NOT NULL,
    organization_name   TEXT        NOT NULL,
    provider_type       TEXT,
    registration_status TEXT,
    team_size           TEXT,
    participant_volume  TEXT,
    contact_number      TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='organizations_service_all') THEN
        CREATE POLICY organizations_service_all ON public.organizations
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='organizations_owner_read') THEN
        CREATE POLICY organizations_owner_read ON public.organizations
            FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
    END IF;
END $$;

-- 2. ORGANIZATION MEMBERS (requires organizations to exist first)
-- ── Step A: column guards FIRST ─────────────────────────────────────────────
-- Wrapped in a DO block so this is safe whether the table already exists or not.
-- If the table doesn't exist yet, the EXCEPTION catches it and step B creates it.
DO $$ BEGIN
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS user_id         UUID;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS role            TEXT NOT NULL DEFAULT 'support_worker';
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS invited_by      UUID;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS joined_at       TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── Step B: create table if it doesn't exist yet ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.organization_members (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL DEFAULT 'support_worker'
                                CHECK (role IN (
                                    'support_worker',
                                    'support_coordinator', 'allied_health',
                                    'managing_director', 'admin'
                                )),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    invited_by      UUID        REFERENCES public.users(id),
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_org_member UNIQUE (user_id, organization_id)
);

-- ── Step C: normalise legacy role values, then widen constraint idempotently ──
DO $$ BEGIN
    UPDATE public.organization_members
    SET role = CASE role
        WHEN 'manager'             THEN 'support_coordinator'
        WHEN 'coordinator'         THEN 'support_coordinator'
        WHEN 'support_coordinator' THEN 'support_coordinator'
        WHEN 'allied_health'       THEN 'allied_health'
        WHEN 'managing_director'   THEN 'managing_director'
        WHEN 'admin'               THEN 'admin'
        ELSE 'support_worker'
    END
    WHERE role NOT IN ('support_worker','support_coordinator','allied_health','managing_director','admin');

    ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
    ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check
        CHECK (role IN ('support_worker','support_coordinator','allied_health','managing_director','admin'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── Step D: indexes (DO blocks — never error even if column just added) ───────
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_org_members_user_id  ON public.organization_members(user_id);         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_org_members_org_id   ON public.organization_members(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_org_members_role     ON public.organization_members(role);            EXCEPTION WHEN others THEN NULL; END $$;

-- ── Step E: RLS & policies ────────────────────────────────────────────────────
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='om_service_role_all') THEN
        CREATE POLICY om_service_role_all ON public.organization_members
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organization_members' AND policyname='om_self_read') THEN
        CREATE POLICY om_self_read ON public.organization_members
            FOR SELECT TO authenticated USING (user_id = auth.uid());
    END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── Step F: backfill (DO block — safe if columns were just added as NULL) ─────
DO $$ BEGIN
    INSERT INTO public.organization_members (user_id, organization_id, role, is_active)
    SELECT
        u.id,
        u.organization_id,
        CASE u.role
            WHEN 'managing_director'   THEN 'managing_director'
            WHEN 'admin'               THEN 'admin'
            WHEN 'manager'             THEN 'support_coordinator'
            WHEN 'support_coordinator' THEN 'support_coordinator'
            WHEN 'allied_health'       THEN 'allied_health'
            ELSE 'support_worker'
        END,
        COALESCE(u.is_active, TRUE)
    FROM public.users u
    WHERE u.organization_id IS NOT NULL
      AND u.id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = u.organization_id)
    ON CONFLICT (user_id, organization_id) DO UPDATE
        SET role      = EXCLUDED.role,
            is_active = EXCLUDED.is_active;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 3. INVITATIONS (requires organizations to exist first)
-- ── Step A: column guards first (safe if table pre-exists without these columns)
DO $$ BEGIN
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS invited_by      UUID;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS email           TEXT;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS token           TEXT;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS accepted_at     TIMESTAMPTZ;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── Step B: create table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS public.invitations (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invited_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    email           TEXT        NOT NULL,
    role            TEXT        NOT NULL DEFAULT 'support_worker'
                                CHECK (role IN (
                                    'support_worker',
                                    'support_coordinator', 'allied_health',
                                    'managing_director', 'admin'
                                )),
    token           TEXT        NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Step C: widen role constraint idempotently
DO $$ BEGIN
    ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check
        CHECK (role IN ('support_worker','support_coordinator','allied_health','managing_director','admin'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── Step D: indexes in DO blocks
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invitations_token  ON public.invitations(token);          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invitations_org_id ON public.invitations(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invitations_email  ON public.invitations(email);           EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invitations' AND policyname='inv_service_role_all') THEN
        CREATE POLICY inv_service_role_all ON public.invitations
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 4. Add organization_id to users if not already present
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'independent_worker';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_data JSONB DEFAULT '{}';

-- 5. Add RBAC ownership columns to patients if not already present
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS assigned_worker_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS allied_health_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS clinician_id UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS owner_user_id UUID;

-- 6. Add RBAC ownership columns to sessions if not already present
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS worker_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS practitioner_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS progress_delta JSONB;

-- 7. Add coordinator_id to users (org hierarchy: which coordinator a worker reports to)
-- NULL = no coordinator assigned yet (valid for coordinators, MDs, and unlinked workers).
-- Set this when a coordinator is assigned to a worker via staff management.
-- Used by get_coordinator_team_ids() in access.py for team-scoped queries.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS coordinator_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_coordinator_id ON public.users(coordinator_id);

-- ── 8. Idempotent column guards for pre-existing tables ──────────────────────
--
-- The CREATE TABLE IF NOT EXISTS blocks above are skipped when the table already
-- exists.  These ALTER TABLE statements run regardless and add any missing columns.
-- They are all safe to re-run (IF NOT EXISTS prevents duplicate-column errors).

-- organizations (may have been created by an older schema without some columns)
DO $$ BEGIN
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS organization_name   TEXT;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS owner_user_id       UUID;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS provider_type       TEXT;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS registration_status TEXT;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS team_size           TEXT;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS participant_volume  TEXT;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS contact_number      TEXT;
    ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- organization_members (may have been created without organization_id / is_active / joined_at)
DO $$ BEGIN
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS role            TEXT NOT NULL DEFAULT 'support_worker';
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS invited_by      UUID;
    ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS joined_at       TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- invitations (may have been created without some columns)
DO $$ BEGIN
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS invited_by      UUID;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS email           TEXT;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS role            TEXT NOT NULL DEFAULT 'support_worker';
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS token           TEXT;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS accepted_at     TIMESTAMPTZ;
    ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Ensure indexes exist even if the table already existed before the patch
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_org_members_user_id  ON public.organization_members(user_id);         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_org_members_org_id   ON public.organization_members(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_org_members_role     ON public.organization_members(role);            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invitations_org_id   ON public.invitations(organization_id);          EXCEPTION WHEN others THEN NULL; END $$;

-- ── 9. organization_id guards on ALL setup-file tables ────────────────────────
--
-- Each table below was created with organization_id in the CREATE TABLE definition
-- inside supabase_setup.sql, but if the table was created by an earlier version
-- of the schema the column may be absent.  These guards fix that silently.

-- All wrapped in DO blocks so this patch never errors even if a table doesn't exist yet.
DO $$ BEGIN ALTER TABLE public.alerts                     ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.audit_logs                 ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.compliance_audit_logs      ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.compliance_rule_results    ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.restrictive_practice_flags ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.ndis_plans                 ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.plan_budgets               ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.budget_usage               ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.note_embeddings            ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- NOTE: onboarding tables use org_id (not organization_id) — confirmed in md_onboarding.py
DO $$ BEGIN ALTER TABLE public.onboarding_programs        ADD COLUMN IF NOT EXISTS org_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.onboarding_stages          ADD COLUMN IF NOT EXISTS org_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.onboarding_stage_resources ADD COLUMN IF NOT EXISTS org_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.onboarding_assignments     ADD COLUMN IF NOT EXISTS org_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.onboarding_stage_progress  ADD COLUMN IF NOT EXISTS org_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_events                 ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.org_events                 ADD COLUMN IF NOT EXISTS created_by      UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.announcements              ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.announcements              ADD COLUMN IF NOT EXISTS created_by      UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.incidents                  ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.session_messages           ADD COLUMN IF NOT EXISTS organization_id UUID; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── 10. is_active / role guards on users ─────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role       TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE;

-- Done! Re-run your backend after applying this patch.
