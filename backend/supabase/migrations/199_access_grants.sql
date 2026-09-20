-- ============================================================
-- Delegated access grants — a scoped, time-boxed exception layered on
-- top of the existing role system. Lets an MD hand a coordinator
-- temporary access to one specific MD-only capability without making
-- them MD, without sharing credentials, and without it lingering past
-- its window. The coordinator's role never changes.
--
-- Deliberately no `status` column (active/expired/revoked) — whether a
-- grant is active is a live computation (revoked_at IS NULL AND
-- expires_at > now()), never a stored value that could drift from
-- reality. See core/access.py::has_active_grant, which is the only
-- thing that actually enforces this.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.access_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,

    granted_to_user_id uuid NOT NULL,
    granted_by_user_id uuid,

    -- One grant, one capability — never a bundle. Values come from the
    -- capability catalog in access_grant_service.py, not freeform text.
    capability text NOT NULL,

    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,

    revoked_at timestamptz,
    revoked_by_user_id uuid,

    reason text,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT access_grants_org_fk FOREIGN KEY (organization_id)
        REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    CONSTRAINT access_grants_granted_to_fk FOREIGN KEY (granted_to_user_id)
        REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT access_grants_granted_by_fk FOREIGN KEY (granted_by_user_id)
        REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT access_grants_revoked_by_fk FOREIGN KEY (revoked_by_user_id)
        REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT access_grants_capability_check CHECK (capability IN (
        'governance_vault',
        'onboarding_program_design',
        'executive_dashboard',
        'delete_staff_account',
        'reassign_coordinator',
        'lock_training_module',
        'hire_paperwork',
        'applicant_offer_reject',
        'staff_invitations',
        'org_branding',
        'platform_billing'
    )),
    CONSTRAINT access_grants_expiry_after_grant_check CHECK (expires_at > granted_at),
    -- One-directional on purpose: revoked_by_user_id being set always implies
    -- revoked_at is too (the only write path, revoke_grant(), sets both
    -- together), but the reverse can't be required — revoked_by_user_id's FK
    -- is ON DELETE SET NULL, so it legitimately goes NULL on its own days or
    -- years later if that MD's account is ever deleted, while revoked_at
    -- must stay put as the historical record that this grant *was* revoked.
    -- A two-directional (both-null-or-both-set) check would make that later
    -- deletion fail outright.
    CONSTRAINT access_grants_revoked_consistency_check CHECK (
        revoked_by_user_id IS NULL OR revoked_at IS NOT NULL
    )
);

-- The query has_active_grant() runs on every gated request: this user, this
-- org, this capability, not revoked, not expired. Index for that exact shape.
CREATE INDEX IF NOT EXISTS idx_access_grants_active_lookup
    ON public.access_grants (granted_to_user_id, organization_id, capability, expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_access_grants_org_id
    ON public.access_grants (organization_id);

ALTER TABLE public.access_grants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'access_grants'
          AND policyname = 'access_grants_service_all'
    ) THEN
        CREATE POLICY access_grants_service_all
        ON public.access_grants FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    END IF;

    -- Org-scoped read backstop. The backend (service role) is the actual
    -- authority on who sees which rows (MD: org-wide, coordinator: own
    -- grants only via GET /me/access-grants) — this policy is a defense-in-
    -- depth boundary at the organisation level, matching every other table
    -- in this codebase's RLS convention.
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'access_grants'
          AND policyname = 'access_grants_org_read'
    ) THEN
        CREATE POLICY access_grants_org_read
        ON public.access_grants FOR SELECT TO authenticated
        USING (organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        ));
    END IF;
END $$;
