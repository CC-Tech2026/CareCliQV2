-- CARECLIQV2-134 — shift task checklist JSONB on shifts table

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS tasks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.shifts.tasks IS
    'Interactive task checklist for clocked-in shifts (CARECLIQV2-134).';

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS tasks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.sessions.tasks IS
    'Shift task checklist mirrored from linked shift (CARECLIQV2-134).';

COMMIT;
