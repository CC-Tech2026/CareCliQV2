-- Platform reference catalogue: CareCliQ's own centrally-maintained NDIS
-- price list. Same effective-dated shape as ndis_price_items
-- (025_ndis_pricing_effective_dated.sql) minus the per-org scoping — this
-- is the thing CareCliQ keeps current, not any individual provider.
--
-- resolve_price() falls back to this table when an org has no explicit
-- override (ndis_price_items.is_override = true) for an item as of the
-- requested date — see the accompanying resolve_price() change. Providers
-- never write to this table directly: only the super-admin-gated
-- load_platform_price_schedule() (ndis_pricing_service.py) does, via the
-- service-role client, hence no "coordinator write" RLS policy here.

CREATE TABLE IF NOT EXISTS public.platform_ndis_price_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year text NOT NULL,
    effective_date date NOT NULL,
    source_document text NOT NULL,
    version text NOT NULL,
    loaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    source_json jsonb,
    created_at timestamptz DEFAULT now(),

    CONSTRAINT platform_ndis_schedules_financial_year_check
        CHECK (financial_year ~ '^\d{4}-\d{2}$'),
    CONSTRAINT platform_ndis_schedules_unique_period
        UNIQUE (financial_year, effective_date)
);

CREATE TABLE IF NOT EXISTS public.platform_ndis_price_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code text NOT NULL,
    schedule_id uuid REFERENCES public.platform_ndis_price_schedules(id) ON DELETE SET NULL,

    support_category_number text,
    support_category_name text,
    support_purpose text,
    registration_group text,
    category_number text,

    name text NOT NULL,
    description text,
    unit text NOT NULL CHECK (unit IN ('H', 'E')),

    price_national numeric(10,2) NOT NULL CHECK (price_national >= 0),
    price_remote numeric(10,2) CHECK (price_remote IS NULL OR price_remote >= 0),
    price_very_remote numeric(10,2) CHECK (price_very_remote IS NULL OR price_very_remote >= 0),

    day_type text,
    time_type text,
    support_intensity text,

    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    created_at timestamptz DEFAULT now(),

    CONSTRAINT platform_ndis_items_valid_dates_check
        CHECK (valid_from <= valid_to OR valid_to IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_platform_ndis_items_item_code
    ON public.platform_ndis_price_items(item_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_ndis_items_active_version
    ON public.platform_ndis_price_items(item_code)
    WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_platform_ndis_items_valid_range
    ON public.platform_ndis_price_items(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_platform_ndis_items_schedule_id
    ON public.platform_ndis_price_items(schedule_id);

-- One active version per item_code platform-wide (mirrors
-- check_ndis_item_uniqueness(), minus the per-org partition — there's
-- only one org-less "org" here).
CREATE OR REPLACE FUNCTION public.check_platform_ndis_item_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.valid_to IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.platform_ndis_price_items
            WHERE item_code = NEW.item_code
              AND valid_to IS NULL
              AND id != NEW.id
        ) THEN
            RAISE EXCEPTION 'Only one active version per item code allowed in the platform catalogue';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_ndis_item_uniqueness ON public.platform_ndis_price_items;
CREATE TRIGGER trg_platform_ndis_item_uniqueness
BEFORE INSERT OR UPDATE ON public.platform_ndis_price_items
FOR EACH ROW EXECUTE FUNCTION public.check_platform_ndis_item_uniqueness();

-- RLS: same data for every org, so authenticated read is unconditional
-- (no organization_id to scope by); only service_role writes.
ALTER TABLE public.platform_ndis_price_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ndis_price_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'platform_ndis_price_schedules'
          AND policyname = 'platform_ndis_schedules_service_all'
    ) THEN
        CREATE POLICY platform_ndis_schedules_service_all
        ON public.platform_ndis_price_schedules FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'platform_ndis_price_schedules'
          AND policyname = 'platform_ndis_schedules_authenticated_read'
    ) THEN
        CREATE POLICY platform_ndis_schedules_authenticated_read
        ON public.platform_ndis_price_schedules FOR SELECT TO authenticated
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'platform_ndis_price_items'
          AND policyname = 'platform_ndis_items_service_all'
    ) THEN
        CREATE POLICY platform_ndis_items_service_all
        ON public.platform_ndis_price_items FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'platform_ndis_price_items'
          AND policyname = 'platform_ndis_items_authenticated_read'
    ) THEN
        CREATE POLICY platform_ndis_items_authenticated_read
        ON public.platform_ndis_price_items FOR SELECT TO authenticated
        USING (true);
    END IF;
END $$;
