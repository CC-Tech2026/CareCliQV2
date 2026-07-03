-- Audit budget_usage rows for rate accuracy vs shift_verifications / ndis_price_items.
-- Run read-only in staging/production before correcting plan_budgets.used_amount.

-- Rows deducted at session save (no shift verification link) — candidates for review
SELECT
  bu.id,
  bu.plan_id,
  bu.session_id,
  bu.category,
  bu.amount,
  bu.hourly_rate,
  bu.duration_minutes,
  bu.created_at,
  'legacy_session_deduction' AS audit_flag
FROM public.budget_usage bu
WHERE bu.shift_verification_id IS NULL
ORDER BY bu.created_at DESC;

-- Rows linked to verification — compare snapshotted rate on shift_verifications
SELECT
  bu.id AS budget_usage_id,
  sv.id AS shift_verification_id,
  sv.price_item_code,
  bu.hourly_rate AS budget_usage_rate,
  sv.hourly_rate_applied AS verification_rate,
  bu.amount AS budget_usage_amount,
  sv.billed_amount AS verification_amount,
  CASE
    WHEN sv.hourly_rate_applied IS NOT NULL
      AND ABS(COALESCE(bu.hourly_rate, 0) - sv.hourly_rate_applied) > 0.01
    THEN 'rate_mismatch'
    WHEN sv.billed_amount IS NOT NULL
      AND ABS(COALESCE(bu.amount, 0) - sv.billed_amount) > 0.01
    THEN 'amount_mismatch'
    ELSE 'ok'
  END AS audit_flag
FROM public.budget_usage bu
JOIN public.shift_verifications sv ON sv.id = bu.shift_verification_id
ORDER BY bu.created_at DESC;

-- Summary counts by org (via plan)
SELECT
  np.organization_id,
  COUNT(*) FILTER (WHERE bu.shift_verification_id IS NULL) AS legacy_rows,
  COUNT(*) FILTER (WHERE bu.shift_verification_id IS NOT NULL) AS verification_rows
FROM public.budget_usage bu
JOIN public.ndis_plans np ON np.id = bu.plan_id
GROUP BY np.organization_id
ORDER BY legacy_rows DESC;
