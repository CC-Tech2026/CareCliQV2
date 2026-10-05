-- Which supports a task template is for (step 3b, agreement-led shifts).
--
-- NDIS support item codes; a template with none applies to any support, as
-- before. A shift delivering an agreement line gets the templates whose
-- codes are in that line's support (its time-of-day and day-type codes
-- count as the same support), so they survive agreement renewals. A code
-- that drops out of the NDIS price guide is flagged on screen rather than
-- quietly stopping matching.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.participant_task_templates
    ADD COLUMN IF NOT EXISTS support_item_codes TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.participant_task_templates.support_item_codes IS
    'NDIS support item codes this task is for. Empty: any support. Matched by support group (time-of-day versions count as one).';

COMMIT;
