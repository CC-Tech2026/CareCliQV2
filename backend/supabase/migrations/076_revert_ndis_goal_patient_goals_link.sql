-- Reverts 075_ndis_goals_patient_goals_sync.sql.
--
-- The ndis_goals -> patient_goals mirror approach is being abandoned in
-- favor of keeping the two tables fully separate (coordinator-side vs
-- worker-side), pending a separate, larger conversation about how/whether
-- to consolidate them. This removes the rows the 075 backfill inserted
-- and the now-unused backlink column.
--
-- Safe to re-run: the DELETE is scoped to rows that can only exist because
-- of the 075 backfill/sync (ndis_goal_id IS NOT NULL), and the
-- DROP COLUMN / DROP INDEX use IF EXISTS.

DELETE FROM public.patient_goals
WHERE ndis_goal_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_patient_goals_ndis_goal_id;

ALTER TABLE public.patient_goals
  DROP COLUMN IF EXISTS ndis_goal_id;
