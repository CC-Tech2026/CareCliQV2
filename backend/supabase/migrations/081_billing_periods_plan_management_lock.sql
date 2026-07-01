-- CARECLIQV2-326 (migration 081): Immutable plan_management_type lock per participant billing period.
-- Billing period default = calendar month (Australia/Adelaide applied in application layer).

BEGIN;

-- Ensure participant plan management columns exist (legacy patch may have applied these).
ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS plan_management_type TEXT,
    ADD COLUMN IF NOT EXISTS plan_management TEXT;

-- Normalize legacy seed / free-text values before CHECK constraint.
UPDATE public.patients
SET plan_management_type = CASE
    WHEN lower(trim(plan_management_type)) IN ('ndia-managed', 'ndia_managed', 'ndia managed') THEN 'NDIA-managed'
    WHEN lower(trim(plan_management_type)) IN ('plan-managed', 'plan_managed', 'plan managed') THEN 'plan-managed'
    WHEN lower(trim(plan_management_type)) IN ('self-managed', 'self_managed', 'self managed') THEN 'self-managed'
    ELSE plan_management_type
END
WHERE plan_management_type IS NOT NULL;

UPDATE public.patients
SET plan_management_type = CASE
    WHEN lower(trim(plan_management)) LIKE '%ndia%' THEN 'NDIA-managed'
    WHEN lower(trim(plan_management)) LIKE '%plan%manage%' THEN 'plan-managed'
    WHEN lower(trim(plan_management)) LIKE '%self%manage%' THEN 'self-managed'
    ELSE plan_management_type
END
WHERE plan_management_type IS NULL
  AND plan_management IS NOT NULL
  AND trim(plan_management) <> '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.patients'::regclass
          AND conname = 'patients_plan_management_type_check'
    ) THEN
        ALTER TABLE public.patients
            ADD CONSTRAINT patients_plan_management_type_check
            CHECK (
                plan_management_type IS NULL OR
                plan_management_type IN ('NDIA-managed', 'plan-managed', 'self-managed')
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_periods (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL,
    participant_id              UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    period_start                DATE NOT NULL,
    period_end                  DATE NOT NULL,
    locked_plan_management_type TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'closed')),
    locked_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT billing_periods_type_check
        CHECK (locked_plan_management_type IN (
            'NDIA-managed', 'plan-managed', 'self-managed'
        )),
    CONSTRAINT billing_periods_dates_check
        CHECK (period_end >= period_start),
    CONSTRAINT billing_periods_unique_participant_period
        UNIQUE (participant_id, period_start)
);

-- FK to organizations — support both id and organization_id column names.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations'
          AND column_name = 'organization_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.billing_periods'::regclass
              AND conname = 'billing_periods_organization_id_fkey'
        ) THEN
            ALTER TABLE public.billing_periods
                ADD CONSTRAINT billing_periods_organization_id_fkey
                FOREIGN KEY (organization_id)
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE;
        END IF;
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.billing_periods'::regclass
          AND conname = 'billing_periods_organization_id_fkey'
    ) THEN
        ALTER TABLE public.billing_periods
            ADD CONSTRAINT billing_periods_organization_id_fkey
            FOREIGN KEY (organization_id)
            REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_periods_org
    ON public.billing_periods(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_periods_participant
    ON public.billing_periods(participant_id);
CREATE INDEX IF NOT EXISTS idx_billing_periods_open
    ON public.billing_periods(participant_id, status)
    WHERE status = 'open';

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS billing_period_id UUID
        REFERENCES public.billing_periods(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_invoices_billing_period_id
    ON public.invoices(billing_period_id)
    WHERE billing_period_id IS NOT NULL;

ALTER TABLE public.billing_periods ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'billing_periods'
          AND policyname = 'billing_periods_service_role_all'
    ) THEN
        CREATE POLICY billing_periods_service_role_all
            ON public.billing_periods
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'cs_user_org_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'billing_periods'
          AND policyname = 'billing_periods_org'
    ) THEN
        CREATE POLICY billing_periods_org ON public.billing_periods
            FOR ALL TO authenticated
            USING (organization_id = public.cs_user_org_id())
            WITH CHECK (organization_id = public.cs_user_org_id());
    END IF;
END $$;

COMMIT;
