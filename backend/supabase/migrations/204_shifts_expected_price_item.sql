-- ============================================================
-- Capture the coordinator's expected NDIS support item at shift
-- creation, so it can be cross-checked against whatever item is
-- actually picked at verification time.
--
-- Nullable and additive: existing shifts and any code path that
-- doesn't set it keep working exactly as before. The coordinator.py
-- insert helper (_insert_shift_with_legacy_fallback) already drops
-- newer optional shift columns on a "missing column" error from an
-- unmigrated deployment, and this column is added to that same
-- fallback list.
-- ============================================================

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS expected_price_item_code text;

INSERT INTO public.audit_log (
    action_type, entity_type, entity_id, user_id, organization_id,
    before_state, after_state, created_at
) VALUES (
    'schema.migration',
    'shifts',
    '00000000-0000-0000-0000-000000000000',
    (SELECT id FROM auth.users WHERE email = 'system@carecliQ.local' LIMIT 1),
    NULL,
    '{"version": "203"}'::jsonb,
    '{"version": "204", "tables": ["shifts"], "change": "added nullable expected_price_item_code text column"}'::jsonb,
    now()
) ON CONFLICT DO NOTHING;

COMMIT;
