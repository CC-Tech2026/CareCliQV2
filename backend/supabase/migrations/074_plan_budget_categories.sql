-- Foundation work for per-category NDIS plan budget tracking.
-- Extends the existing plan_budgets table (already category-scoped, already
-- wired into funding_service.get_budget_summary / upsert_plan_budget / the
-- NDIS Plan tab) rather than introducing a second, parallel budget table.
--
-- Categories are NOT a hardcoded enum. The organization's loaded NDIS
-- pricing schedule (ndis_price_items.category_number) is the real, fundable
-- category list — see ndis_pricing_service.list_organization_categories
-- and funding_service.list_available_categories. Orgs with no pricing
-- schedule loaded yet fall back to the 3 legacy broad buckets that already
-- exist in this table ('core' | 'capacity_building' | 'capital').
--
-- This migration adds:
--   - category_group: coarse Core/Capacity/Capital classification for UI
--     sectioning, derived from the matching price item's support_purpose
--     (or the legacy bucket) at write time.
--   - category_name: a label snapshot captured when the category was chosen
--     (mirrors how invoice line items snapshot pricing rather than
--     re-deriving it later) so existing budgets keep a sensible label even
--     if the org's pricing schedule changes wording later.
--   - updated_at: existing pattern on ndis_plans, missing here.
-- No CHECK constraint enumerates `category` itself — the valid set is
-- per-organization and dynamic, so it is validated at the application layer
-- (funding_service.list_available_categories) instead of the database layer.

ALTER TABLE public.plan_budgets
  ADD COLUMN IF NOT EXISTS category_group text,
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill existing rows from their (legacy, broad) category.
UPDATE public.plan_budgets
SET
  category_group = CASE category
    WHEN 'core'              THEN 'core_supports'
    WHEN 'capacity_building' THEN 'capacity_building'
    WHEN 'capital'           THEN 'capital_supports'
    ELSE category_group
  END,
  category_name = CASE category
    WHEN 'core'              THEN 'Core Supports (General)'
    WHEN 'capacity_building' THEN 'Capacity Building (General)'
    WHEN 'capital'           THEN 'Capital Supports (General)'
    ELSE category_name
  END
WHERE category_group IS NULL;

ALTER TABLE public.plan_budgets
  ALTER COLUMN category_group SET NOT NULL;

ALTER TABLE public.plan_budgets
  DROP CONSTRAINT IF EXISTS plan_budgets_category_group_valid;
ALTER TABLE public.plan_budgets
  ADD CONSTRAINT plan_budgets_category_group_valid
  CHECK (category_group IN ('core_supports', 'capacity_building', 'capital_supports'));

ALTER TABLE public.plan_budgets
  DROP CONSTRAINT IF EXISTS plan_budgets_allocated_non_negative;
ALTER TABLE public.plan_budgets
  ADD CONSTRAINT plan_budgets_allocated_non_negative
  CHECK (allocated_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_plan_budgets_category_group ON public.plan_budgets(category_group);

COMMENT ON COLUMN public.plan_budgets.category_group IS 'Coarse NDIS group: core_supports | capacity_building | capital_supports';
COMMENT ON COLUMN public.plan_budgets.category       IS 'Fundable category identifier: legacy bucket (core|capacity_building|capital) or an org''s ndis_price_items.category_number';
COMMENT ON COLUMN public.plan_budgets.category_name  IS 'Human label snapshot for the category, captured when set; see funding_service.list_available_categories for the live source';
