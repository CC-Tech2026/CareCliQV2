-- Medication Management v2 step 2: approval and confirmation before a medication goes live.
--
-- A medication now moves through a fixed status lifecycle, and only one transition (verify)
-- unlocks it for the worker-facing shift checklist, which already filters on status='active'
-- (medication_service.build_shift_medication_checklist) so no checklist change is needed —
-- draft/pending_verification medications simply don't show up there yet, same as today.
--
-- on_hold is kept: it's an orthogonal, already-shipped concept (temporarily pause an
-- already-active medication), not part of this approval lifecycle.

BEGIN;

-- Find and drop the existing status CHECK constraint by introspection rather than assuming
-- its auto-generated name, since a mismatch here would silently leave the old
-- ('active','ceased','on_hold')-only constraint in place and reject every new status value.
DO $$
DECLARE
    existing_constraint TEXT;
BEGIN
    SELECT con.conname INTO existing_constraint
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'medications'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    LIMIT 1;

    IF existing_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.medications DROP CONSTRAINT %I', existing_constraint);
    END IF;
END $$;

ALTER TABLE public.medications ADD CONSTRAINT medications_status_check
    CHECK (status IN ('draft', 'pending_verification', 'active', 'rejected', 'ceased', 'on_hold'));

ALTER TABLE public.medications
    ALTER COLUMN status SET DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES public.medication_documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_notes TEXT,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Existing rows predate this lifecycle — they were already live before an approval step
-- existed, so grandfather them in as verified rather than yanking them off worker checklists.
UPDATE public.medications
    SET verified_at = COALESCE(verified_at, created_at)
    WHERE status = 'active' AND verified_at IS NULL;

CREATE TABLE IF NOT EXISTS public.medication_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id   UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    changed_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_medication_status_history_medication
    ON public.medication_status_history(medication_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_medication_status_history_org
    ON public.medication_status_history(organization_id);

CREATE OR REPLACE FUNCTION public.medication_status_history_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'medication_status_history rows are immutable and append-only.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS medication_status_history_no_update ON public.medication_status_history;
CREATE TRIGGER medication_status_history_no_update
    BEFORE UPDATE OR DELETE ON public.medication_status_history
    FOR EACH ROW EXECUTE FUNCTION public.medication_status_history_prevent_modify();

ALTER TABLE public.medication_status_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medication_status_history' AND policyname = 'medication_status_history_service_role') THEN
        CREATE POLICY medication_status_history_service_role ON public.medication_status_history FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
