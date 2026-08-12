-- Medication Management v2 step 3: structured administration outcomes with time variance.
--
-- Replaces the 4-value status (given/refused/missed/withheld) with a 6-value outcome that
-- splits "given" by timing (given_on_time/given_late/given_early), computed from the
-- worker-logged administered_time against the scheduled_time and the org's configured
-- tolerance window — not typed/self-classified by the worker under time pressure.
--
-- variance_minutes is a generated column (pure arithmetic on this row's own two timestamps).
-- The on-time/late/early classification itself is NOT a generated column — it needs the
-- org's medication_tolerance_minutes, a cross-table lookup Postgres generated columns can't
-- do — so that classification happens in application code (medication_service.py) at write
-- time, using this column's value.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS medication_tolerance_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE public.medication_administrations
    ADD COLUMN IF NOT EXISTS outcome TEXT,
    ADD COLUMN IF NOT EXISTS reason_code TEXT,
    ADD COLUMN IF NOT EXISTS directed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS variance_minutes INTEGER GENERATED ALWAYS AS (
        CASE WHEN scheduled_time IS NOT NULL
             THEN ROUND(EXTRACT(EPOCH FROM (administered_time - scheduled_time)) / 60)::INTEGER
             ELSE NULL
        END
    ) STORED;

-- Backfill outcome from the existing status + variance vs each row's org's tolerance
-- (falling back to 30 if the org row can't be found for some reason).
UPDATE public.medication_administrations ma
SET outcome = CASE
    WHEN ma.status != 'given' THEN ma.status
    WHEN ma.scheduled_time IS NULL THEN 'given_on_time'
    WHEN ABS(EXTRACT(EPOCH FROM (ma.administered_time - ma.scheduled_time)) / 60)
         <= COALESCE((SELECT o.medication_tolerance_minutes FROM public.organizations o WHERE o.organization_id = ma.organization_id), 30)
         THEN 'given_on_time'
    WHEN ma.administered_time > ma.scheduled_time THEN 'given_late'
    ELSE 'given_early'
END
WHERE ma.outcome IS NULL;

ALTER TABLE public.medication_administrations
    ALTER COLUMN outcome SET NOT NULL;

-- Drop the old status CHECK constraint (introspected, not name-assumed — see 113 for why)
-- before dropping the column itself.
DO $$
DECLARE
    existing_constraint TEXT;
BEGIN
    SELECT con.conname INTO existing_constraint
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'medication_administrations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    LIMIT 1;

    IF existing_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.medication_administrations DROP CONSTRAINT %I', existing_constraint);
    END IF;
END $$;

ALTER TABLE public.medication_administrations DROP COLUMN IF EXISTS status;

ALTER TABLE public.medication_administrations ADD CONSTRAINT medication_administrations_outcome_check
    CHECK (outcome IN ('given_on_time', 'given_late', 'given_early', 'refused', 'missed', 'withheld'));

-- Immutability trigger, rebuilt for the new column set (status -> outcome, + reason_code/
-- directed_by/variance_minutes — variance_minutes is a generated column so Postgres computes
-- it itself on every row version and it will never appear as a genuine NEW/OLD difference here).
--
-- Keeps the prn_effect_observed/voice_captured follow-up carve-out from 106, and adds a second,
-- equally narrow one: reason_code/notes may be filled in as a follow-up too. This exists
-- specifically for "given" doses — a worker taps "confirm given" not knowing in advance
-- whether the server will classify it given_on_time or given_late/given_early (that
-- classification depends on the org's tolerance, computed after the fact), so a reason for a
-- late/early dose is necessarily attached in a second step, once the worker sees the outcome.
-- It is NOT a general-purpose edit path — the *transition into* refused/missed/withheld still
-- requires a correction row, same as everything else.
CREATE OR REPLACE FUNCTION public.medication_administrations_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'medication_administrations rows cannot be deleted; insert a correction row instead';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.medication_id IS DISTINCT FROM OLD.medication_id
        OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
        OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.administered_by IS DISTINCT FROM OLD.administered_by
        OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
        OR NEW.administered_time IS DISTINCT FROM OLD.administered_time
        OR NEW.outcome IS DISTINCT FROM OLD.outcome
        OR NEW.directed_by IS DISTINCT FROM OLD.directed_by
        OR NEW.dose_given IS DISTINCT FROM OLD.dose_given
        OR NEW.prn_reason IS DISTINCT FROM OLD.prn_reason
        OR NEW.corrects_administration_id IS DISTINCT FROM OLD.corrects_administration_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'medication_administrations rows are immutable except the prn_effect_observed/voice_captured and reason_code/notes follow-ups; insert a correction row instead';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
