-- Applicants Board (Kanban hiring pipeline): Applied -> Interview ->
-- Offer extended -> Hired / Rejected. This is the front half of hiring,
-- feeding into the existing employee_onboarding table (103) at the Offer
-- extended stage rather than duplicating its documents/signature flow —
-- employee_onboarding_id is set the moment a card reaches Offer extended,
-- and stage flips to 'hired' as a side effect of the candidate actually
-- signing (see employee_onboarding_service.sign_as_worker), not a manual
-- board action.

BEGIN;

CREATE TABLE IF NOT EXISTS public.applicants (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    full_name               TEXT        NOT NULL,
    email                   TEXT        NOT NULL,
    phone                   TEXT,
    role                    TEXT        NOT NULL DEFAULT 'support_worker'
                            CHECK (role IN ('support_worker', 'support_coordinator')),
    stage                   TEXT        NOT NULL DEFAULT 'applied'
                            CHECK (stage IN ('applied', 'interview', 'offer_extended', 'hired', 'rejected')),
    notes                   TEXT,
    stage_entered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    stage_reminder_sent_at  TIMESTAMPTZ,
    rejected_reason         TEXT,
    employee_onboarding_id  UUID        REFERENCES public.employee_onboarding(id) ON DELETE SET NULL,
    created_by              UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicants_org_stage
    ON public.applicants (organization_id, stage);

CREATE INDEX IF NOT EXISTS idx_applicants_employee_onboarding
    ON public.applicants (employee_onboarding_id)
    WHERE employee_onboarding_id IS NOT NULL;

ALTER TABLE public.applicants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'applicants'
        AND policyname = 'applicants_service_role'
    ) THEN
        CREATE POLICY applicants_service_role
        ON public.applicants
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

COMMIT;
