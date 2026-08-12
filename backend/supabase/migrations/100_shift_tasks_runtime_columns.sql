-- CARECLIQV2-330: Per-shift task runtime state on normalized shift_tasks.
-- participant_tasks remains the task definition; shift_tasks is the junction + progress.

BEGIN;

ALTER TABLE public.shift_tasks
  ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER,
  ADD COLUMN IF NOT EXISTS marked_na BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS na_reason TEXT;

-- Deduplicate before unique constraint (keep earliest row per shift/task).
DELETE FROM public.shift_tasks a
USING public.shift_tasks b
WHERE a.ctid > b.ctid
  AND a.shift_id = b.shift_id
  AND a.task_id = b.task_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shift_tasks_shift_id_task_id_key'
  ) THEN
    ALTER TABLE public.shift_tasks
      ADD CONSTRAINT shift_tasks_shift_id_task_id_key UNIQUE (shift_id, task_id);
  END IF;
END $$;

COMMENT ON COLUMN public.shift_tasks.completed IS
  'Worker checklist completion for this shift';
COMMENT ON COLUMN public.shift_tasks.note IS
  'Per-shift worker note for the linked participant_tasks definition';

COMMIT;
