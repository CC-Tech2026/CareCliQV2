-- Urgent, standalone: re-assert the correct valid_to filter on
-- public.resolve_ndis_price(), the SQL RPC that record_task_completion()
-- (backend/app/api/ndis_tasks.py) calls to estimate billed amounts.
--
-- 025_ndis_pricing_effective_dated.sql's CREATE OR REPLACE already defines
-- this function with the correct half-open filter
-- (valid_to IS NULL OR valid_to > p_as_of_date), which supersedes 020's
-- earlier version. So per the migration files, this function should
-- already be correct on any database where migrations ran in order.
--
-- Shipping this anyway, unconditionally, because: (a) this exact table has
-- a documented history of live-database drift from its migration files
-- (see 099/202/203_ndis_price_items_*.sql), (b) there is no way to
-- introspect the live function definition from this environment (no direct
-- Postgres connection string, no Supabase management API token — only
-- PostgREST table access), and (c) CREATE OR REPLACE with this exact body
-- is a safe no-op if 025's version is already live, and a real fix if it
-- somehow isn't. This is intentionally byte-for-byte the same function
-- body as 025 — not a behavior change beyond guaranteeing the filter is
-- actually in place.
--
-- Note: this function is a near-term-retirement candidate — see the
-- follow-up migration that drops it once record_task_completion() is
-- consolidated onto the Python ndis_pricing_service.resolve_price(). This
-- migration exists purely to close the exposure window in the meantime.

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
    -- Find current version valid as of p_as_of_date. valid_to is a
    -- half-open upper bound: NULL or strictly after p_as_of_date means
    -- current; anything else is an expired version and must be excluded.
    SELECT * INTO v_row
    FROM public.ndis_price_items
    WHERE item_code = p_item_code
      AND organization_id = p_org_id
      AND valid_from::date <= p_as_of_date
      AND (valid_to::date IS NULL OR valid_to::date > p_as_of_date)
    ORDER BY valid_from DESC
    LIMIT 1;

    IF v_row IS NULL THEN
        RETURN;
    END IF;

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
