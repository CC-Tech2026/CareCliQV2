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
CREATE TABLE IF NOT EXISTS public.organization_members (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL DEFAULT 'support_worker'
                                CHECK (role IN (
                                    'support_worker',
                                    'support_coordinator', 'allied_health'
                                )),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    invited_by      UUID        REFERENCES public.users(id),
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_org_member UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id  ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id   ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role     ON public.organization_members(role);

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
END $$;

-- Backfill existing users who already completed onboarding
INSERT INTO public.organization_members (user_id, organization_id, role, is_active)
SELECT
    u.id,
    u.organization_id,
    CASE u.role
        WHEN 'admin'               THEN 'support_coordinator'
        WHEN 'manager'             THEN 'support_coordinator'
        WHEN 'support_coordinator' THEN 'support_coordinator'
        WHEN 'allied_health'       THEN 'allied_health'
        ELSE 'support_worker'
    END,
    u.is_active
FROM public.users u
WHERE u.organization_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = u.organization_id)
ON CONFLICT (user_id, organization_id) DO UPDATE
    SET role      = EXCLUDED.role,
        is_active = EXCLUDED.is_active;

-- 3. INVITATIONS (requires organizations to exist first)
CREATE TABLE IF NOT EXISTS public.invitations (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invited_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    email           TEXT        NOT NULL,
    role            TEXT        NOT NULL DEFAULT 'support_worker'
                                CHECK (role IN (
                                    'support_worker',
                                    'support_coordinator', 'allied_health'
                                )),
    token           TEXT        NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token  ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_org_id ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email  ON public.invitations(email);

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

-- Done! Re-run your backend after applying this patch.
