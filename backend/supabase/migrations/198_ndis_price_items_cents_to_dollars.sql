-- ============================================================
-- Fix ndis_price_items being loaded in cents instead of dollars
--
-- price_national/price_remote/price_very_remote is numeric(10,2) and the
-- rest of the codebase (NdisPriceEditor.tsx, billing.tsx, invoice_service.py,
-- billing_service.py, the resolve_ndis_price RPC) treats it as a plain
-- dollar amount. The bulk price-guide import that populated this table
-- loaded cents-scale figures instead (e.g. 10014 for a $100.14/hr item),
-- which was only being corrected for by an undocumented /100 in
-- shift_verification_service.py — silently 100x-wrong everywhere else that
-- reads this table directly (manual invoice line items, the price editor).
--
-- This converts every existing row to real dollars. shift_verification_
-- service.py's /100 is removed in the same change (see that file).
--
-- Guarded by price_national > 1000: no genuine NDIS hourly rate in this
-- catalogue is anywhere near that, so this only touches rows still stuck in
-- cents-scale and safely no-ops on rows already fixed (e.g. the dev database
-- this was authored against, which was corrected directly before this file
-- was written) or ever re-run.
-- ============================================================

UPDATE public.ndis_price_items
SET
    price_national = ROUND(price_national / 100.0, 2),
    price_remote = CASE WHEN price_remote IS NULL THEN NULL ELSE ROUND(price_remote / 100.0, 2) END,
    price_very_remote = CASE WHEN price_very_remote IS NULL THEN NULL ELSE ROUND(price_very_remote / 100.0, 2) END
WHERE price_national > 1000;

INSERT INTO public.audit_log (
    action_type, entity_type, entity_id, user_id, organization_id,
    before_state, after_state, created_at
) VALUES (
    'schema.migration',
    'ndis_pricing',
    '00000000-0000-0000-0000-000000000000',
    (SELECT id FROM auth.users WHERE email = 'system@carecliQ.local' LIMIT 1),
    NULL,
    '{"version": "197"}'::jsonb,
    '{"version": "198", "tables": ["ndis_price_items"], "change": "price_national/remote/very_remote divided by 100 (cents -> dollars) where price_national > 1000"}'::jsonb,
    now()
) ON CONFLICT DO NOTHING;
