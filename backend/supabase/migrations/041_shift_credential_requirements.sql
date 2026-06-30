-- CARECLIQV2-302 — Shift-Credential requirements matrix

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_credential_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    shift_type TEXT NOT NULL,
    required_credential_type TEXT NOT NULL,
    minimum_status TEXT NOT NULL DEFAULT 'valid'
        CHECK (minimum_status IN ('valid')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shift_credential_requirements_unique
        UNIQUE (organization_id, shift_type, required_credential_type, minimum_status)
);

CREATE INDEX IF NOT EXISTS idx_shift_cred_requirements_org_shift
    ON public.shift_credential_requirements (organization_id, shift_type);

CREATE INDEX IF NOT EXISTS idx_shift_cred_requirements_active
    ON public.shift_credential_requirements (is_active)
    WHERE is_active = TRUE;

ALTER TABLE public.shift_credential_requirements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_credential_requirements' AND policyname = 'shift_cred_requirements_org_select'
    ) THEN
        CREATE POLICY shift_cred_requirements_org_select
        ON public.shift_credential_requirements
        FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shift_credential_requirements' AND policyname = 'shift_cred_requirements_service_role'
    ) THEN
        CREATE POLICY shift_cred_requirements_service_role
        ON public.shift_credential_requirements
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

COMMIT;
