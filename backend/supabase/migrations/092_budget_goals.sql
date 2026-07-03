-- Link budget_usage ledger rows to shift verifications.
-- Backfill ndis_goals.support_category where goal_area is unambiguous.

BEGIN;

ALTER TABLE public.budget_usage
  ADD COLUMN IF NOT EXISTS shift_verification_id uuid
    REFERENCES public.shift_verifications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budget_usage_shift_verification
  ON public.budget_usage (shift_verification_id)
  WHERE shift_verification_id IS NOT NULL;

COMMENT ON COLUMN public.budget_usage.shift_verification_id IS
  'Set when budget is deducted via coordinator shift verification (CARECLIQV2-327).';

-- Backfill support_category from goal_area where mapping is unambiguous.
-- Goals with goal_area = other, or plans with multiple budget lines, stay NULL for coordinator review.
UPDATE public.ndis_goals g
SET support_category = CASE g.goal_area
  WHEN 'daily_living' THEN 'core_daily_activities'
  WHEN 'community'    THEN 'core_social_community'
  WHEN 'health'       THEN 'cb_health_wellbeing'
  WHEN 'social'       THEN 'cb_social_skills'
  WHEN 'employment'   THEN 'cb_employment'
  ELSE NULL
END
WHERE g.support_category IS NULL
  AND g.goal_area IS NOT NULL
  AND g.goal_area <> 'other'
  AND (
    g.plan_id IS NULL
    OR (
      SELECT COUNT(DISTINCT pb.category)
      FROM public.plan_budgets pb
      WHERE pb.plan_id = g.plan_id
    ) <= 1
  );

COMMIT;
