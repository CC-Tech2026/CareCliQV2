-- Coordinator-created goals live in ndis_goals (participant_id-linked,
-- api/coordinator.py's /goals routes), but the support-worker side reads
-- patient_goals (plan_id-linked, goals_service.get_goals_for_participant /
-- shift_service._fetch_active_goals_for_participant) — two separate tables
-- that never synced, so coordinator goals never reached workers.
--
-- Rather than repointing the worker-facing reads at ndis_goals (which would
-- touch code the support-worker-side developer is actively working on),
-- this adds a nullable backlink column so coordinator.py can mirror each
-- ndis_goals write into a corresponding patient_goals row, keeping
-- patient_goals as the single read source for workers regardless of which
-- flow created the goal. Purely additive — no existing column/behavior
-- changes.

ALTER TABLE public.patient_goals
  ADD COLUMN IF NOT EXISTS ndis_goal_id uuid REFERENCES public.ndis_goals(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_goals_ndis_goal_id
  ON public.patient_goals(ndis_goal_id)
  WHERE ndis_goal_id IS NOT NULL;

COMMENT ON COLUMN public.patient_goals.ndis_goal_id IS 'Backlink to the ndis_goals row this was mirrored from, when created via the coordinator Goals & Tasks tab. NULL for goals created directly in patient_goals.';

-- One-time backfill: mirror existing ndis_goals rows that don't have a
-- corresponding patient_goals row yet, so already-created coordinator
-- goals show up for workers immediately (not just future writes).
INSERT INTO public.patient_goals (
  plan_id, ndis_goal_id, title, description, category, target_date,
  why_it_matters, status, priority, worker_focus
)
SELECT
  p.id,
  g.id,
  g.name,
  g.description,
  'general', -- patient_goals.category is constrained to general/core/capacity_building;
             -- ndis_goals.goal_area uses a different vocabulary (community/daily_living/social)
             -- that doesn't map cleanly, so mirrored rows default to 'general'.
  g.target_date,
  g.success_criteria,
  COALESCE(g.status, 'active'),
  99,
  '[]'::jsonb
FROM public.ndis_goals g
JOIN public.ndis_plans p
  ON p.patient_id = g.participant_id
  AND p.status = 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.patient_goals pg WHERE pg.ndis_goal_id = g.id
);
