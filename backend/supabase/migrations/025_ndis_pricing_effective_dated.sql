-- ============================================================
-- NDIS Effective-Dated Pricing Schema
-- Adds versioned, editable NDIS item pricing with fallback 
-- multipliers for remote/very-remote locations
-- ============================================================

-- ── Table 1: Price Schedules (bulk loads) ──────────────────
CREATE TABLE IF NOT EXISTS public.ndis_price_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    financial_year text NOT NULL,
    effective_date date NOT NULL,
    source_document text NOT NULL,
    version text NOT NULL,
    superseded_date date,
    loaded_by uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    
    CONSTRAINT ndis_schedules_org_fk FOREIGN KEY (organization_id)
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT ndis_schedules_financial_year_check
        CHECK (financial_year ~ '^\d{4}-\d{2}$'),
    CONSTRAINT ndis_schedules_unique_period
        UNIQUE (organization_id, financial_year, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_ndis_schedules_org_id
    ON public.ndis_price_schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_ndis_schedules_effective_date
    ON public.ndis_price_schedules(effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_ndis_schedules_superseded
    ON public.ndis_price_schedules(superseded_date);

-- ── Table 2: Versioned Price Items ─────────────────────────
CREATE TABLE IF NOT EXISTS public.ndis_price_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    item_code text NOT NULL,
    schedule_id uuid,
    
    support_category_number text NOT NULL,
    support_category_name text NOT NULL,
    support_purpose text NOT NULL,
    registration_group text NOT NULL,
    
    name text NOT NULL,
    description text,
    unit text NOT NULL,
    
    price_national numeric(10,2) NOT NULL,
    price_remote numeric(10,2),
    price_very_remote numeric(10,2),
    
    day_type text,
    time_type text,
    support_intensity text,
    notes text,
    
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    edited_by uuid NOT NULL,
    edited_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now(),
    
    CONSTRAINT ndis_items_org_fk FOREIGN KEY (organization_id)
        REFERENCES public.organizations(id) ON DELETE CASCADE,
    CONSTRAINT ndis_items_schedule_fk FOREIGN KEY (schedule_id)
        REFERENCES public.ndis_price_schedules(id) ON DELETE SET NULL,
    CONSTRAINT ndis_items_prices_nonnegative
        CHECK (price_national >= 0 AND (price_remote IS NULL OR price_remote >= 0) 
               AND (price_very_remote IS NULL OR price_very_remote >= 0)),
    CONSTRAINT ndis_items_unit_check
        CHECK (unit IN ('H', 'E')),
    CONSTRAINT ndis_items_purpose_check
        CHECK (support_purpose IN ('Core Supports', 'Capacity Building')),
    CONSTRAINT ndis_items_valid_dates_check
        CHECK (valid_from <= valid_to OR valid_to IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_ndis_items_org_id
    ON public.ndis_price_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_ndis_items_item_code
    ON public.ndis_price_items(item_code, organization_id);
CREATE INDEX IF NOT EXISTS idx_ndis_items_current_version
    ON public.ndis_price_items(item_code, organization_id, valid_from DESC)
    WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_ndis_items_schedule_id
    ON public.ndis_price_items(schedule_id);
CREATE INDEX IF NOT EXISTS idx_ndis_items_valid_range
    ON public.ndis_price_items(valid_from, valid_to);

-- ── Modify invoices: add FK to price item version ──────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'invoices'
          AND column_name = 'ndis_price_item_id'
    ) THEN
        ALTER TABLE public.invoices
        ADD COLUMN ndis_price_item_id uuid,
        ADD CONSTRAINT invoices_ndis_item_fk FOREIGN KEY (ndis_price_item_id)
            REFERENCES public.ndis_price_items(id) ON DELETE RESTRICT;
        
        CREATE INDEX IF NOT EXISTS idx_invoices_ndis_price_item_id
            ON public.invoices(ndis_price_item_id);
    END IF;
END $$;

-- ── Row-Level Security ─────────────────────────────────────
ALTER TABLE public.ndis_price_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ndis_price_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Service role: all access
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ndis_price_schedules'
          AND policyname = 'ndis_schedules_service_all'
    ) THEN
        CREATE POLICY ndis_schedules_service_all
        ON public.ndis_price_schedules FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    END IF;

    -- Authenticated users: org-scoped read
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ndis_price_schedules'
          AND policyname = 'ndis_schedules_org_read'
    ) THEN
        CREATE POLICY ndis_schedules_org_read
        ON public.ndis_price_schedules FOR SELECT TO authenticated
        USING (organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        ));
    END IF;

    -- Service role: all access
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ndis_price_items'
          AND policyname = 'ndis_items_service_all'
    ) THEN
        CREATE POLICY ndis_items_service_all
        ON public.ndis_price_items FOR ALL TO service_role
        USING (true) WITH CHECK (true);
    END IF;

    -- Authenticated users: org-scoped read
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ndis_price_items'
          AND policyname = 'ndis_items_org_read'
    ) THEN
        CREATE POLICY ndis_items_org_read
        ON public.ndis_price_items FOR SELECT TO authenticated
        USING (organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        ));
    END IF;

    -- Authenticated users (coordinator): can insert/update
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ndis_price_items'
          AND policyname = 'ndis_items_coordinator_write'
    ) THEN
        CREATE POLICY ndis_items_coordinator_write
        ON public.ndis_price_items FOR INSERT TO authenticated
        WITH CHECK (organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        ));
    END IF;
END $$;

-- ── Helper function: resolve price for item at point in time ─
CREATE OR REPLACE FUNCTION public.resolve_ndis_price(
    p_item_code text,
    p_org_id uuid,
    p_as_of_date date DEFAULT CURRENT_DATE,
    p_location_type text DEFAULT 'national'
)
RETURNS TABLE (
    id uuid,
    item_code text,
    name text,
    description text,
    unit text,
    price_national numeric,
    price_remote numeric,
    price_very_remote numeric,
    effective_price numeric,
    effective_price_source text,
    day_type text,
    time_type text,
    support_intensity text,
    support_purpose text
) AS $$
DECLARE
    v_row RECORD;
    v_effective_price numeric;
    v_source text;
BEGIN
    -- Find current version valid as of p_as_of_date
    SELECT * INTO v_row
    FROM public.ndis_price_items
    WHERE item_code = p_item_code
      AND organization_id = p_org_id
      AND valid_from::date <= p_as_of_date
      AND (valid_to::date IS NULL OR valid_to::date > p_as_of_date)
    LIMIT 1;

    IF v_row IS NULL THEN
        RETURN;
    END IF;

    -- Determine effective price based on location type
    IF p_location_type = 'remote' THEN
        IF v_row.price_remote IS NOT NULL THEN
            v_effective_price := v_row.price_remote;
            v_source := 'explicit';
        ELSE
            v_effective_price := v_row.price_national * 1.25;
            v_source := 'calculated_multiplier';
        END IF;
    ELSIF p_location_type = 'very_remote' THEN
        IF v_row.price_very_remote IS NOT NULL THEN
            v_effective_price := v_row.price_very_remote;
            v_source := 'explicit';
        ELSE
            v_effective_price := v_row.price_national * 1.40;
            v_source := 'calculated_multiplier';
        END IF;
    ELSE
        -- national
        v_effective_price := v_row.price_national;
        v_source := 'explicit';
    END IF;

    RETURN QUERY
    SELECT
        v_row.id,
        v_row.item_code,
        v_row.name,
        v_row.description,
        v_row.unit,
        v_row.price_national,
        v_row.price_remote,
        v_row.price_very_remote,
        v_effective_price,
        v_source,
        v_row.day_type,
        v_row.time_type,
        v_row.support_intensity,
        v_row.support_purpose;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Trigger: ensure at most one active version per item ──────
CREATE OR REPLACE FUNCTION public.check_ndis_item_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.valid_to IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.ndis_price_items
            WHERE item_code = NEW.item_code
              AND organization_id = NEW.organization_id
              AND valid_to IS NULL
              AND id != NEW.id
        ) THEN
            RAISE EXCEPTION 'Only one active version per item code per organization allowed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ndis_item_uniqueness ON public.ndis_price_items;
CREATE TRIGGER trg_ndis_item_uniqueness
BEFORE INSERT OR UPDATE ON public.ndis_price_items
FOR EACH ROW EXECUTE FUNCTION public.check_ndis_item_uniqueness();

-- ── Audit log entry for schema migration ────────────────────
INSERT INTO public.audit_log (
    action_type, entity_type, entity_id, user_id, organization_id,
    before_state, after_state, created_at
) VALUES (
    'schema.migration',
    'ndis_pricing',
    '00000000-0000-0000-0000-000000000000',
    (SELECT id FROM auth.users WHERE email = 'system@carecliQ.local' LIMIT 1),
    NULL,
    '{"version": "024"}'::jsonb,
    '{"version": "025", "tables": ["ndis_price_schedules", "ndis_price_items"], "modified": ["invoices"]}'::jsonb,
    now()
) ON CONFLICT DO NOTHING;
