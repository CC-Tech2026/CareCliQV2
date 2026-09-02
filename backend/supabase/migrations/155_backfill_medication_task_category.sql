-- Backfill category='medication' for existing task templates/instances named
-- like "Medication Administration" whose category was never set (NULL, or
-- defaulted to 'other' before this naming convention existed). The mobile
-- app now uses task.category === 'medication' to embed the real dosing
-- checklist inside this task instead of a generic free-text note thread —
-- without this backfill, every pre-existing org's medication task silently
-- falls back to the generic thread with no indication anything is wrong.

BEGIN;

UPDATE public.participant_task_templates
SET category = 'medication'
WHERE (category IS NULL OR category = 'other')
  AND name ILIKE '%medication%';

UPDATE public.participant_tasks
SET category = 'medication'
WHERE (category IS NULL OR category = 'other')
  AND name ILIKE '%medication%';

COMMIT;
