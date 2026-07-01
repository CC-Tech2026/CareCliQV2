-- Read-only duplicate / drift diagnostics (run in Supabase SQL Editor).
-- Safe to run anytime; makes no changes.

-- ── 1. Patient plan mirror vs ndis_plans (should be 0 after 086) ─────────────
SELECT
    p.id,
    p.full_name,
    p.plan_start_date   AS patient_start,
    np.plan_start       AS plan_start,
    p.plan_end_date     AS patient_end,
    np.plan_end         AS plan_end,
    p.total_budget      AS patient_budget,
    np.total_funding    AS plan_funding,
    p.plan_status       AS patient_status,
    np.status           AS plan_status
FROM public.patients p
JOIN LATERAL (
    SELECT *
    FROM public.ndis_plans
    WHERE patient_id = p.id
    ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        plan_start DESC NULLS LAST,
        created_at DESC NULLS LAST
    LIMIT 1
) np ON true
WHERE p.plan_start_date IS DISTINCT FROM np.plan_start
   OR p.plan_end_date   IS DISTINCT FROM np.plan_end
   OR COALESCE(p.total_budget, 0) IS DISTINCT FROM COALESCE(np.total_funding, 0)
   OR COALESCE(p.plan_status, '') IS DISTINCT FROM COALESCE(np.status, '');

-- ── 2. Participants with goals but no NDIS plan ─────────────────────────────
SELECT p.id, p.full_name, COUNT(g.id) AS goal_count
FROM public.patients p
JOIN public.ndis_goals g ON g.participant_id = p.id
LEFT JOIN public.ndis_plans np ON np.patient_id = p.id
WHERE np.id IS NULL
GROUP BY p.id, p.full_name;

-- ── 3. ndis_goals missing plan_id ─────────────────────────────────────────────
SELECT g.id, g.participant_id, g.name, g.status
FROM public.ndis_goals g
LEFT JOIN public.ndis_plans np ON np.patient_id = g.participant_id
WHERE g.plan_id IS NULL
  AND np.id IS NOT NULL;

-- ── 4. Duplicate active goals (same participant + name) ───────────────────────
SELECT participant_id, lower(trim(name)) AS norm_name, COUNT(*) AS cnt
FROM public.ndis_goals
WHERE status = 'active'
GROUP BY participant_id, lower(trim(name))
HAVING COUNT(*) > 1;

-- ── 5. plan_budgets.used_amount vs budget_usage sum ───────────────────────────
SELECT
    pb.id,
    pb.plan_id,
    pb.category,
    pb.used_amount,
    COALESCE(u.calculated, 0) AS usage_sum,
    pb.used_amount - COALESCE(u.calculated, 0) AS drift
FROM public.plan_budgets pb
LEFT JOIN (
    SELECT plan_id, category, ROUND(SUM(amount)::numeric, 2) AS calculated
    FROM public.budget_usage
    GROUP BY plan_id, category
) u ON u.plan_id = pb.plan_id AND u.category = pb.category
WHERE ABS(pb.used_amount - COALESCE(u.calculated, 0)) > 0.01;

-- ── 6. sessions.goals_addressed pointing to missing goals ────────────────────
SELECT s.id AS session_id, elem AS invalid_goal_ref
FROM public.sessions s
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
        WHEN jsonb_typeof(s.goals_addressed) = 'array' THEN s.goals_addressed
        ELSE '[]'::jsonb
    END
) AS elem
WHERE elem !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR NOT EXISTS (SELECT 1 FROM public.ndis_goals ng WHERE ng.id::text = elem);
