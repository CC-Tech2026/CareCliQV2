-- Drop deprecated / unused schema objects identified in redundancy audit.
-- Safe after 069_unify_ndis_goals.sql has migrated patient_goals → ndis_goals.
--
-- NOT included (still referenced by app code):
--   patients.total_budget (legacy fallback until plan_budgets-only),
--   patients.plan_start_date/plan_end_date (duplicate of ndis_plans),
--   sessions.support_worker_id, budget dual-tracking tables.

BEGIN;

-- ── 1. Deprecated goals table (replaced by ndis_goals) ───────────────────────
DROP TABLE IF EXISTS public.patient_goals CASCADE;

-- ── 2. Unused ndis_goals column ──────────────────────────────────────────────
ALTER TABLE public.ndis_goals
  DROP COLUMN IF EXISTS related_task_ids;

-- ── 3. Superseded task-template goal link (use linked_goal_id) ───────────────
ALTER TABLE public.participant_task_templates
  DROP COLUMN IF EXISTS linked_goal_ids;

-- ── 4. Unused patient columns ────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_patients_support_worker_id;
DROP INDEX IF EXISTS public.idx_patients_ndis_plan_id;

ALTER TABLE public.patients
  DROP COLUMN IF EXISTS ndis_plan_id,
  DROP COLUMN IF EXISTS support_worker_id,
  DROP COLUMN IF EXISTS goals_met;

COMMIT;
