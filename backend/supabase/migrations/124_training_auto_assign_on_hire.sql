-- Lets an org mark a training module as mandatory for every new hire, so it
-- can be auto-assigned the moment an invited worker accepts their account
-- (see backend/app/api/invitations.py, accept-invite flow), instead of
-- relying on a coordinator remembering to assign it manually.

BEGIN;

ALTER TABLE public.training_modules
    ADD COLUMN IF NOT EXISTS auto_assign_on_hire BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_training_modules_auto_assign
    ON public.training_modules (organization_id)
    WHERE auto_assign_on_hire = true AND is_active = true;

COMMIT;
