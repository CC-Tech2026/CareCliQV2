-- participant_tasks.task_template_id: which care-plan template a task came from.
--
-- Shift creation used to insert a brand-new participant_tasks row for every
-- matching template on every shift, so each participant's task list filled
-- up with copies, and one-off / daily / weekly templates couldn't tell they
-- had already been used. A template now has one task per participant that
-- each shift links to (shift_tasks); task_template_id is how it's found.
--
-- The column already exists on the live database, referencing
-- participant_task_templates, but no migration in this repo created it — so
-- a freshly built database wouldn't have it. This adds it where it's
-- missing and stops if it exists pointing at anything else (the app writes
-- participant_task_templates ids into it). Not to be confused with
-- task_instances.task_template_id (068), a different table.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.participant_tasks
    ADD COLUMN IF NOT EXISTS task_template_id UUID
        REFERENCES public.participant_task_templates(id) ON DELETE SET NULL;

DO $$
DECLARE
    target REGCLASS;
BEGIN
    SELECT con.confrelid::regclass INTO target
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.participant_tasks'::regclass
      AND con.contype = 'f'
      AND att.attname = 'task_template_id'
    LIMIT 1;

    IF target IS NULL THEN
        ALTER TABLE public.participant_tasks
            ADD CONSTRAINT participant_tasks_task_template_id_fkey
            FOREIGN KEY (task_template_id) REFERENCES public.participant_task_templates(id) ON DELETE SET NULL;
    ELSIF target <> 'public.participant_task_templates'::regclass THEN
        RAISE EXCEPTION 'participant_tasks.task_template_id references %, expected participant_task_templates', target;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_participant_tasks_task_template
    ON public.participant_tasks (participant_id, task_template_id)
    WHERE task_template_id IS NOT NULL;

COMMENT ON COLUMN public.participant_tasks.task_template_id IS
    'The participant_task_templates row this task was generated from; one task per template per participant, linked to each shift through shift_tasks.';

COMMIT;
