-- Org-level switch for the future platform NDIS price catalogue (not yet
-- built — see the "Platform Reference Catalogue" design). Default on:
-- most providers want centrally-maintained rates to apply automatically.
-- Off means the org intends to review each schedule change itself before
-- it takes effect; setting an item-level override in ndis_price_items is
-- what actually opts a single item out, this column only controls the
-- org-wide default.
--
-- Column only — no behaviour depends on it yet. The fallback logic that
-- would read it (resolving to a platform_ndis_price_items table when an
-- org has no override) hasn't been built, and neither has that table.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS auto_adopt_platform_rates boolean NOT NULL DEFAULT true;
