-- Employee onboarding hires: MD/coordinator creates a new-hire record with offer
-- letter + service agreement, both sides sign, then an invitation is sent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_onboarding (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    created_by            UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    full_name             TEXT        NOT NULL,
    email                 TEXT        NOT NULL,
    phone                 TEXT,
    role                  TEXT        NOT NULL DEFAULT 'support_worker'
                          CHECK (role IN ('support_worker', 'support_coordinator')),
    status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'awaiting_signatures', 'signed', 'invited', 'completed')),
    sign_token            TEXT        UNIQUE,
    employer_signed_by    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    employer_signed_name  TEXT,
    employer_signed_at    TIMESTAMPTZ,
    worker_signed_name    TEXT,
    worker_signed_at      TIMESTAMPTZ,
    invitation_id         UUID        REFERENCES public.invitations(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_org
    ON public.employee_onboarding (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_sign_token
    ON public.employee_onboarding (sign_token)
    WHERE sign_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.employee_onboarding_documents (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_id    UUID        NOT NULL REFERENCES public.employee_onboarding(id) ON DELETE CASCADE,
    document_type    TEXT        NOT NULL DEFAULT 'other'
                     CHECK (document_type IN ('offer_letter', 'service_agreement', 'other')),
    title            TEXT        NOT NULL,
    notes            TEXT,
    file_path        TEXT,
    file_url         TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_onboarding_documents_onboarding
    ON public.employee_onboarding_documents (onboarding_id);

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS onboarding_id UUID REFERENCES public.employee_onboarding(id) ON DELETE SET NULL;

ALTER TABLE public.employee_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_onboarding_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'employee_onboarding'
        AND policyname = 'employee_onboarding_service_role'
    ) THEN
        CREATE POLICY employee_onboarding_service_role
        ON public.employee_onboarding
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'employee_onboarding_documents'
        AND policyname = 'employee_onboarding_documents_service_role'
    ) THEN
        CREATE POLICY employee_onboarding_documents_service_role
        ON public.employee_onboarding_documents
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;
