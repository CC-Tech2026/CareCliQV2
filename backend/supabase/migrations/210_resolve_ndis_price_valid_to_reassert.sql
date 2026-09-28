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
    p_as_of_date date,
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
    support_purpose text,
    category_number text,
    registration_group text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        npi.id,
        npi.item_code,
        npi.name,
        npi.description,
        npi.unit,
        npi.price_national,
        npi.price_remote,
        npi.price_very_remote,
        CASE
            WHEN p_location_type = 'national' THEN npi.price_national
            WHEN p_location_type = 'remote' THEN COALESCE(npi.price_remote, npi.price_national)
            WHEN p_location_type = 'very_remote' THEN COALESCE(npi.price_very_remote, npi.price_national)
            ELSE npi.price_national
        END AS effective_price,
        CASE
            WHEN p_location_type = 'national' AND npi.price_national IS NOT NULL THEN 'explicit'
            WHEN p_location_type = 'remote' AND npi.price_remote IS NOT NULL THEN 'explicit'
            WHEN p_location_type = 'remote' AND npi.price_remote IS NULL AND npi.price_national IS NOT NULL THEN 'calculated_multiplier'
            WHEN p_location_type = 'very_remote' AND npi.price_very_remote IS NOT NULL THEN 'explicit'
            WHEN p_location_type = 'very_remote' AND npi.price_very_remote IS NULL AND npi.price_national IS NOT NULL THEN 'calculated_multiplier'
            ELSE 'explicit'
        END AS effective_price_source,
        npi.day_type,
        npi.time_type,
        npi.support_intensity,
        npi.support_purpose,
        npi.category_number,
        npi.registration_group
    FROM public.ndis_price_items AS npi
    WHERE npi.item_code = p_item_code
      AND npi.organization_id = p_org_id
      AND npi.valid_from <= p_as_of_date
      AND (npi.valid_to IS NULL OR npi.valid_to > p_as_of_date)
    ORDER BY npi.valid_from DESC
    LIMIT 1;
END;
$function$;