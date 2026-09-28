-- Correction to 212_ndis_price_items_is_override.sql's own comment, which
-- asserted edited_by/edited_at are "present since 020" and therefore don't
-- need adding here. That's wrong: 020_ndis_pricing_functions.sql's file
-- does declare them, but a live query against this table just now
-- (2026-09-23) confirms neither column actually exists — the exact same
-- live-database-drift-from-migration-files pattern already documented for
-- this table (099/202/203/210's own comment). edit_item_price() already
-- writes both columns unconditionally on every manual edit (see the
-- accompanying code change) — without this migration, that insert fails
-- outright the moment anyone edits a price, the same "column not found"
-- failure this exact function has hit twice before for the same reason
-- (schedule_id, support_category_number/name/notes).
--
-- DEPLOY ORDER: apply this (and 212) before deploying the backend build
-- containing edit_item_price()'s is_override/edited_by/edited_at writes —
-- opposite ordering constraint from 211, which must apply after its
-- deploy. Both are satisfied by: run 212 and this migration now, then
-- deploy, then run 211.

ALTER TABLE public.ndis_price_items
    ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS edited_at timestamptz;
