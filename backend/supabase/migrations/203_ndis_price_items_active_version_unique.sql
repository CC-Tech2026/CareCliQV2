-- ============================================================
-- Fix ndis_price_items uniqueness to allow historical versions
--
-- The live database carries a plain UNIQUE(item_code, organization_id)
-- constraint named ndis_price_items_item_code_org_unique. It isn't
-- declared in any migration file in this repo — it was added directly
-- against the database at some point, alongside other drift (the live
-- table's columns match neither 020_ndis_pricing_functions.sql nor
-- 025_ndis_pricing_effective_dated.sql exactly).
--
-- That blunt constraint blocks the effective-dated design the rest of
-- the schema assumes: 025's check_ndis_item_uniqueness() trigger already
-- allows multiple rows per (item_code, organization_id) as long as only
-- one has valid_to IS NULL (the "active" version), so a new financial
-- year's prices can be loaded by closing out the old row instead of
-- deleting it. The blunt constraint rejects the new row outright, which
-- blocks every organization's annual price update, not just one.
--
-- Replaces it with a partial unique index scoped to active rows only,
-- matching what the trigger already assumes.
-- ============================================================

BEGIN;

ALTER TABLE public.ndis_price_items
    DROP CONSTRAINT IF EXISTS ndis_price_items_item_code_org_unique;

CREATE UNIQUE INDEX IF NOT EXISTS ndis_price_items_item_code_org_active_idx
    ON public.ndis_price_items (item_code, organization_id)
    WHERE valid_to IS NULL;

INSERT INTO public.audit_log (
    action_type, entity_type, entity_id, user_id, organization_id,
    before_state, after_state, created_at
) VALUES (
    'schema.migration',
    'ndis_pricing',
    '00000000-0000-0000-0000-000000000000',
    (SELECT id FROM auth.users WHERE email = 'system@carecliQ.local' LIMIT 1),
    NULL,
    '{"version": "202"}'::jsonb,
    '{"version": "203", "tables": ["ndis_price_items"], "change": "dropped blunt UNIQUE(item_code, organization_id), added partial unique index WHERE valid_to IS NULL"}'::jsonb,
    now()
) ON CONFLICT DO NOTHING;

COMMIT;
