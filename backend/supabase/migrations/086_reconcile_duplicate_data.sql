-- Reconcile duplicate / stale data after goals + plan normalization.
-- Run AFTER 084 and 085 when possible. Idempotent.
--
-- Live DB audit (pre-migration) found:
--   47 ndis_goals missing plan_id
--   15 duplicate active goal names
--   19/24 plan_budgets.used_amount drift vs budget_usage
--   19 sessions with invalid goals_addressed (legacy_* / goal_* string IDs)

BEGIN;

-- ── 1. Link ndis_goals to each participant's current plan ────────────────────
UPDATE public.ndis_goals g
SET
    plan_id = np.id,
    updated_at = now()
FROM (
    SELECT DISTINCT ON (patient_id)
        id,
        patient_id
    FROM public.ndis_plans
    ORDER BY
        patient_id,
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        plan_start DESC NULLS LAST,
        created_at DESC NULLS LAST
) np
WHERE g.participant_id = np.patient_id
  AND g.plan_id IS NULL;

-- ── 2. Archive duplicate active goals (keep oldest per participant + name) ───
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY participant_id, lower(trim(name))
            ORDER BY priority ASC NULLS LAST, created_at ASC, id ASC
        ) AS rn
    FROM public.ndis_goals
    WHERE status = 'active'
)
UPDATE public.ndis_goals g
SET
    status = 'archived',
    archived_at = COALESCE(g.archived_at, now()),
    updated_at = now()
FROM ranked r
WHERE g.id = r.id
  AND r.rn > 1;

-- ── 3. Sync patient plan mirror FROM ndis_plans (plan is authoritative) ──────
UPDATE public.patients p
SET
    plan_start_date = np.plan_start,
    plan_end_date   = np.plan_end,
    total_budget    = np.total_funding,
    plan_status     = COALESCE(np.status, p.plan_status),
    updated_at      = now()
FROM (
    SELECT DISTINCT ON (patient_id)
        patient_id,
        plan_start,
        plan_end,
        total_funding,
        status
    FROM public.ndis_plans
    ORDER BY
        patient_id,
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        plan_start DESC NULLS LAST,
        created_at DESC NULLS LAST
) np
WHERE p.id = np.patient_id
  AND (
        p.plan_start_date IS DISTINCT FROM np.plan_start
     OR p.plan_end_date   IS DISTINCT FROM np.plan_end
     OR COALESCE(p.total_budget, 0) IS DISTINCT FROM COALESCE(np.total_funding, 0)
     OR COALESCE(p.plan_status, '') IS DISTINCT FROM COALESCE(np.status, '')
  );

-- ── 4. Reconcile plan_budgets.used_amount from budget_usage ledger rows ───────
UPDATE public.plan_budgets pb
SET used_amount = COALESCE(u.calculated, 0)
FROM (
    SELECT
        plan_id,
        category,
        ROUND(SUM(amount)::numeric, 2) AS calculated
    FROM public.budget_usage
    GROUP BY plan_id, category
) u
WHERE pb.plan_id = u.plan_id
  AND pb.category = u.category
  AND pb.used_amount IS DISTINCT FROM COALESCE(u.calculated, 0);

UPDATE public.plan_budgets pb
SET used_amount = 0
WHERE NOT EXISTS (
    SELECT 1
    FROM public.budget_usage bu
    WHERE bu.plan_id = pb.plan_id
      AND bu.category = pb.category
)
AND COALESCE(pb.used_amount, 0) <> 0;

-- ── 5. Strip invalid session goal references (legacy string IDs) ───────────────
UPDATE public.sessions s
SET
    goals_addressed = COALESCE(cleaned.val, '[]'::jsonb),
    updated_at = now()
FROM (
    SELECT
        s2.id,
        (
            SELECT jsonb_agg(to_jsonb(elem))
            FROM jsonb_array_elements_text(
                CASE
                    WHEN jsonb_typeof(s2.goals_addressed) = 'array' THEN s2.goals_addressed
                    ELSE '[]'::jsonb
                END
            ) AS elem
            WHERE elem ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND EXISTS (
                  SELECT 1
                  FROM public.ndis_goals ng
                  WHERE ng.id::text = elem
              )
        ) AS val
    FROM public.sessions s2
) cleaned
WHERE s.id = cleaned.id
  AND s.goals_addressed IS DISTINCT FROM COALESCE(cleaned.val, '[]'::jsonb);

COMMIT;
