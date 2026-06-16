-- CARECLIQV2-158 — risk acknowledgement before shift start

BEGIN;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS risks_acknowledged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS risks_acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.shifts.risks_acknowledged_at IS
    'When the assigned worker acknowledged participant risks (CARECLIQV2-158).';

COMMIT;
