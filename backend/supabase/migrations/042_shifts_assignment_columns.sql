-- CARECLIQV2-300 — align shifts schema with coordinator assignment payload

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS shift_type TEXT NOT NULL DEFAULT 'standard_support',
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.shifts.shift_type IS
    'Normalized shift category for rostering and credential matrix checks (CARECLIQV2-300).';

COMMENT ON COLUMN public.shifts.created_by IS
    'Coordinator user that created/assigned the shift (CARECLIQV2-300).';

CREATE INDEX IF NOT EXISTS idx_shifts_org_shift_type
    ON public.shifts (organization_id, shift_type);

CREATE INDEX IF NOT EXISTS idx_shifts_created_by
    ON public.shifts (created_by)
    WHERE created_by IS NOT NULL;

COMMIT;
