-- 158_schads_award_engine.sql
-- SCHADS Award (MA000100) pay-calculation engine — Phase 1.
--
-- Two patterns already used elsewhere in this schema are mirrored here rather
-- than invented fresh:
--   1. Effective-dated resolver, same shape as resolve_ndis_price() /
--      ndis_price_items (025_ndis_pricing_effective_dated.sql) — valid_from/
--      valid_to, a partial "current row" index, and a uniqueness trigger.
--      Deviation: ndis_price_items is organization_id-scoped because a
--      provider sets its own NDIS prices; SCHADS rates are a national legal
--      instrument, identical for every organization, so award_classifications
--      and award_allowances carry NO organization_id.
--   2. Immutable append-only ledger, same shape as budget_transactions
--      (001_create_budget_transactions_ledger.sql) — signed amount_cents,
--      a BEFORE UPDATE OR DELETE trigger that raises, and RLS policies that
--      deny UPDATE/DELETE outright. Corrections are new 'reversal' rows,
--      never edits.
--
-- Known, disclosed gaps in this phase (not silently wrong, just not built
-- yet — see the Phase 1 plan):
--   - Only SACS stream classifications are seeded (pay point 1 of each
--     level). Home Care / Crisis Accommodation / Family Day Care rows exist
--     in award_streams but have no rate data yet.
--   - public_holidays is seeded with fixed national dates only (no state-
--     specific days, no weekend-observed-date substitution).
--   - Evening/night shift loading is not priced (see schads_engine.py) —
--     the user's own reference document flags the exact percentage as
--     unconfirmed against the Fair Work Pay and Conditions Tool.
--   - Sleepover and broken-shift component types are defined below so a
--     later migration isn't needed to add them, but nothing writes them yet.

-- ── award_streams ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.award_streams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.award_streams (code, name, is_default) VALUES
    ('sacs',                'Social and Community Services',  true),
    ('home_care',           'Home Care',                       false),
    ('crisis_accommodation','Crisis Accommodation',             false),
    ('family_day_care',     'Family Day Care',                  false)
ON CONFLICT (code) DO NOTHING;

-- ── award_classifications ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.award_classifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id uuid NOT NULL REFERENCES public.award_streams(id) ON DELETE RESTRICT,
    level text NOT NULL,
    pay_point text NOT NULL DEFAULT '1',
    base_rate numeric(10,2) NOT NULL,
    casual_rate numeric(10,2) NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    source_document text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT award_classifications_rates_nonnegative
        CHECK (base_rate >= 0 AND casual_rate >= 0),
    CONSTRAINT award_classifications_valid_dates_check
        CHECK (valid_from <= valid_to OR valid_to IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_award_classifications_stream
    ON public.award_classifications(stream_id, level, pay_point);
CREATE INDEX IF NOT EXISTS idx_award_classifications_current_version
    ON public.award_classifications(stream_id, level, pay_point, valid_from DESC)
    WHERE valid_to IS NULL;

CREATE OR REPLACE FUNCTION public.check_award_classification_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.valid_to IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.award_classifications
            WHERE stream_id = NEW.stream_id
              AND level = NEW.level
              AND pay_point = NEW.pay_point
              AND valid_to IS NULL
              AND id != NEW.id
        ) THEN
            RAISE EXCEPTION 'Only one active version per (stream, level, pay_point) allowed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_award_classification_uniqueness ON public.award_classifications;
CREATE TRIGGER trg_award_classification_uniqueness
BEFORE INSERT OR UPDATE ON public.award_classifications
FOR EACH ROW EXECUTE FUNCTION public.check_award_classification_uniqueness();

-- Seed: SACS stream, pay point 1 of each level, effective 1 Jul 2026 Fair
-- Work Annual Wage Review (+4.75%). Cross-checked against the user-supplied
-- reference document (matches to the cent on Level 2) as well as independent
-- web research this session — see source_document. Only pay point 1 is
-- seeded per level; higher pay points within a level are not yet loaded.
INSERT INTO public.award_classifications (stream_id, level, pay_point, base_rate, casual_rate, valid_from, source_document)
SELECT s.id, v.level, '1', v.base_rate, v.casual_rate, '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026 Annual Wage Review — verified via research, cross-checked against internal reference doc, 2026-09-03'
FROM public.award_streams s
CROSS JOIN (VALUES
    ('1', 27.55, 34.44),
    ('2', 36.22, 45.27),
    ('3', 40.49, 50.61),
    ('4', 46.70, 58.38),
    ('5', 53.43, 66.79),
    ('6', 58.37, 72.96),
    ('7', 63.13, 78.91),
    ('8', 68.49, 85.61)
) AS v(level, base_rate, casual_rate)
WHERE s.code = 'sacs'
ON CONFLICT DO NOTHING;

-- ── award_allowances ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.award_allowances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    allowance_type text NOT NULL,
    rate numeric(10,2) NOT NULL,
    unit text NOT NULL CHECK (unit IN ('per_period', 'per_km', 'per_shift', 'per_week', 'flat')),
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    source_document text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT award_allowances_rate_nonnegative CHECK (rate >= 0),
    CONSTRAINT award_allowances_valid_dates_check CHECK (valid_from <= valid_to OR valid_to IS NULL),
    CONSTRAINT award_allowances_type_check CHECK (allowance_type IN (
        'on_call_weekday', 'on_call_weekend', 'travel_km', 'first_aid', 'uniform', 'laundry',
        'sleepover', 'broken_shift_one_break', 'broken_shift_two_breaks'
    ))
);

CREATE INDEX IF NOT EXISTS idx_award_allowances_current_version
    ON public.award_allowances(allowance_type, valid_from DESC)
    WHERE valid_to IS NULL;

CREATE OR REPLACE FUNCTION public.check_award_allowance_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.valid_to IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.award_allowances
            WHERE allowance_type = NEW.allowance_type
              AND valid_to IS NULL
              AND id != NEW.id
        ) THEN
            RAISE EXCEPTION 'Only one active version per allowance_type allowed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_award_allowance_uniqueness ON public.award_allowances;
CREATE TRIGGER trg_award_allowance_uniqueness
BEFORE INSERT OR UPDATE ON public.award_allowances
FOR EACH ROW EXECUTE FUNCTION public.check_award_allowance_uniqueness();

INSERT INTO public.award_allowances (allowance_type, rate, unit, valid_from, source_document) VALUES
    ('on_call_weekday',          25.66, 'per_period', '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026'),
    ('on_call_weekend',          50.81, 'per_period', '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026'),
    ('travel_km',                 1.01, 'per_km',     '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026'),
    ('first_aid',                21.43, 'per_week',   '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026'),
    ('uniform',                   1.26, 'per_shift',  '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026 (weekly cap not yet enforced)'),
    ('laundry',                   0.33, 'per_shift',  '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026'),
    ('sleepover',                62.87, 'flat',       '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026 — data only, not yet priced by the engine'),
    ('broken_shift_one_break',   21.81, 'flat',       '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026 — data only, not yet priced by the engine'),
    ('broken_shift_two_breaks',  28.87, 'flat',       '2026-07-01T00:00:00+10:00', 'Fair Work MA000100, 1 Jul 2026 — data only, not yet priced by the engine')
ON CONFLICT DO NOTHING;

-- ── resolve_award_rate() ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_award_rate(
    p_stream_id uuid,
    p_level text,
    p_pay_point text DEFAULT '1',
    p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    id uuid,
    stream_id uuid,
    level text,
    pay_point text,
    base_rate numeric,
    casual_rate numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.stream_id, c.level, c.pay_point, c.base_rate, c.casual_rate
    FROM public.award_classifications c
    WHERE c.stream_id = p_stream_id
      AND c.level = p_level
      AND c.pay_point = p_pay_point
      AND c.valid_from::date <= p_as_of_date
      AND (c.valid_to::date IS NULL OR c.valid_to::date > p_as_of_date)
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── public_holidays ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_holidays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    holiday_date date NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- National Australian public holidays only (no state-specific days, no
-- weekend-observed-date substitution) — see header note.
INSERT INTO public.public_holidays (holiday_date, name) VALUES
    ('2026-01-01', 'New Year''s Day'),
    ('2026-01-26', 'Australia Day'),
    ('2026-04-03', 'Good Friday'),
    ('2026-04-06', 'Easter Monday'),
    ('2026-04-25', 'Anzac Day'),
    ('2026-12-25', 'Christmas Day'),
    ('2026-12-26', 'Boxing Day'),
    ('2027-01-01', 'New Year''s Day'),
    ('2027-01-26', 'Australia Day'),
    ('2027-03-26', 'Good Friday'),
    ('2027-03-29', 'Easter Monday'),
    ('2027-04-25', 'Anzac Day'),
    ('2027-12-25', 'Christmas Day'),
    ('2027-12-26', 'Boxing Day')
ON CONFLICT (holiday_date) DO NOTHING;

-- ── pay_transactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pay_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    worker_id uuid NOT NULL,
    shift_id uuid NOT NULL,
    segment_id uuid, -- unused until Phase 2's shift_segments table exists
    component_type text NOT NULL,
    amount_cents bigint NOT NULL,
    rate_used numeric(10,4),
    hours_applied numeric(10,4),
    award_classification_id uuid REFERENCES public.award_classifications(id),
    calculation_run_id uuid NOT NULL,
    -- metadata.reverses_id links a 'reversal' row back to the transaction it
    -- cancels out, so a recompute (e.g. daily overtime re-run) can tell which
    -- prior rows are already reversed without ever editing them in place.
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by text NOT NULL DEFAULT 'schads_engine',
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pay_transactions_amount_valid CHECK (amount_cents != 0),
    CONSTRAINT pay_transactions_component_type_valid CHECK (component_type IN (
        'base_pay', 'penalty_saturday', 'penalty_sunday', 'penalty_public_holiday', 'penalty_evening',
        'casual_loading', 'overtime_1_5x', 'overtime_2x', 'minimum_engagement_topup',
        'on_call_allowance', 'travel_allowance', 'first_aid_allowance', 'uniform_allowance', 'laundry_allowance',
        'sleepover_allowance', 'broken_shift_allowance', 'reversal'
    ))
);

CREATE INDEX IF NOT EXISTS idx_pay_transactions_worker_created ON public.pay_transactions(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_transactions_shift ON public.pay_transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_pay_transactions_org ON public.pay_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_pay_transactions_run ON public.pay_transactions(calculation_run_id);

CREATE OR REPLACE FUNCTION public.pay_transactions_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'pay_transactions: UPDATE not allowed. Append-only ledger requires immutability. Use a reversal transaction.';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'pay_transactions: DELETE not allowed. Append-only ledger requires immutability. Use a reversal transaction.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pay_transactions_immutable ON public.pay_transactions;
CREATE TRIGGER pay_transactions_immutable
    BEFORE UPDATE OR DELETE ON public.pay_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.pay_transactions_prevent_modify();

ALTER TABLE public.pay_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_transactions_service_all ON public.pay_transactions;
CREATE POLICY pay_transactions_service_all
    ON public.pay_transactions FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pay_transactions_org_read ON public.pay_transactions;
CREATE POLICY pay_transactions_org_read
    ON public.pay_transactions FOR SELECT TO authenticated
    USING (organization_id IN (
        SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    ));

DROP POLICY IF EXISTS pay_transactions_no_update ON public.pay_transactions;
CREATE POLICY pay_transactions_no_update ON public.pay_transactions FOR UPDATE USING (FALSE);

DROP POLICY IF EXISTS pay_transactions_no_delete ON public.pay_transactions;
CREATE POLICY pay_transactions_no_delete ON public.pay_transactions FOR DELETE USING (FALSE);

-- ── users: classification + employment type ─────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS classification_id uuid REFERENCES public.award_classifications(id),
    ADD COLUMN IF NOT EXISTS employment_type text CHECK (employment_type IN ('casual', 'part_time', 'full_time')),
    ADD COLUMN IF NOT EXISTS written_agreement_12hr boolean NOT NULL DEFAULT false;

-- ── shifts: duty type ─────────────────────────────────────────────────────
ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS duty_type text NOT NULL DEFAULT 'disability_services'
    CHECK (duty_type IN ('disability_services', 'general_sacs'));
