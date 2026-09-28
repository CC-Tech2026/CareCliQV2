-- Explicit, unambiguous marker for "this row is a provider's own negotiated
-- rate" vs "this row is just what got bulk-loaded and never touched" —
-- needed before any platform-reference-catalogue migration can decide
-- which org rows should keep blocking a platform-rate fallback and which
-- can be safely superseded.
--
-- Not inferable after the fact in general: edit_item_price() carries the
-- old row's schedule_id forward onto the edited row, and neither
-- edit_item_price() nor load_price_schedule() has ever populated
-- edited_by/edited_at, so those columns (present since 020) don't
-- distinguish anything either. edit_item_price() now sets is_override
-- explicitly going forward (see the accompanying code change) — this
-- column is not maintained by any trigger, only by that one write path.
--
-- Best-effort backfill for existing rows: audit_logs is the one place the
-- distinction survives today, since edit_item_price() (and only that
-- function) logs an 'ndis_price.edited' entry with entity_id = the new
-- row's id. Any row with a matching entry was a real manual edit; set
-- is_override = true for those. Everything else is left false rather than
-- guessed at — see the read-only audit run from this session for the
-- actual size of that bucket (as of 2026-09-23: 745/745 current rows,
-- i.e. no row in the live table has a surviving edit_item_price() audit
-- trail — the one 'ndis_price.edited' entry that exists is an orphaned
-- verification-test row that was manually deleted afterward, so it
-- matches nothing). That number is expected to be exactly this stark
-- until a provider actually uses the manual-edit path for the first time.

ALTER TABLE public.ndis_price_items
    ADD COLUMN IF NOT EXISTS is_override boolean NOT NULL DEFAULT false;

UPDATE public.ndis_price_items
SET is_override = true
WHERE id::text IN (
    SELECT entity_id
    FROM public.audit_logs
    WHERE entity_type = 'ndis_price_items'
      AND action_type = 'ndis_price.edited'
);
