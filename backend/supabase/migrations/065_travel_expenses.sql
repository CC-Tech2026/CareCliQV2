-- CARECLIQV2-292 — Worker travel expense tracking & reimbursement

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_travel_settings (
    organization_id    UUID        PRIMARY KEY REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    mileage_rate_cents INTEGER     NOT NULL DEFAULT 88 CHECK (mileage_rate_cents > 0),
    currency           TEXT        NOT NULL DEFAULT 'AUD',
    updated_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_mileage_rate_history (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    rate_cents       INTEGER     NOT NULL CHECK (rate_cents > 0),
    effective_from   DATE        NOT NULL DEFAULT CURRENT_DATE,
    created_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mileage_rate_history_org
    ON public.organization_mileage_rate_history (organization_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.travel_expense_submissions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL,
    total_amount_cents  INTEGER     NOT NULL DEFAULT 0 CHECK (total_amount_cents >= 0),
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    actioned_at         TIMESTAMPTZ,
    actioned_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    rejection_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_travel_submissions_worker
    ON public.travel_expense_submissions (worker_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.shift_travel_expenses (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id              UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id       UUID        NOT NULL,
    expense_type          TEXT        NOT NULL CHECK (expense_type IN ('mileage', 'transit')),
    status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'rejected')),
    submission_batch_id   UUID        REFERENCES public.travel_expense_submissions(id) ON DELETE SET NULL,
    calculated_km         NUMERIC(8,2),
    claimed_km            NUMERIC(8,2),
    rate_cents_snapshot   INTEGER,
    amount_cents          INTEGER     NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    transit_type          TEXT        CHECK (transit_type IS NULL OR transit_type IN ('bus', 'train', 'tram', 'ferry', 'other')),
    receipt_storage_path  TEXT,
    submitted_at          TIMESTAMPTZ,
    approved_at           TIMESTAMPTZ,
    approved_by           UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    paid_at               TIMESTAMPTZ,
    rejected_at           TIMESTAMPTZ,
    rejection_reason      TEXT,
    correction_of_id      UUID        REFERENCES public.shift_travel_expenses(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_travel_expenses_worker
    ON public.shift_travel_expenses (worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_travel_expenses_shift
    ON public.shift_travel_expenses (shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_travel_expenses_status
    ON public.shift_travel_expenses (worker_id, status)
    WHERE status IN ('draft', 'submitted');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'travel-receipts',
    'travel-receipts',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.organization_travel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_mileage_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_expense_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_travel_expenses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shift_travel_expenses' AND policyname = 'shift_travel_expenses_service_role') THEN
        CREATE POLICY shift_travel_expenses_service_role ON public.shift_travel_expenses FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'travel_expense_submissions' AND policyname = 'travel_expense_submissions_service_role') THEN
        CREATE POLICY travel_expense_submissions_service_role ON public.travel_expense_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'organization_travel_settings' AND policyname = 'organization_travel_settings_service_role') THEN
        CREATE POLICY organization_travel_settings_service_role ON public.organization_travel_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
