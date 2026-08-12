-- Medication Management v1: prescribed medications + append-only administration ledger.
--
-- Deliberately reuses existing structures rather than duplicating them:
--   - Allergies already live in public.participant_allergies (036_participant_context.sql) — not recreated.
--   - Conditions already live in patients.current_conditions (freeform) — not recreated.
--   - GP/prescriber contact is new; added directly to patients, matching the existing
--     case_manager_name/case_manager_phone columns from 036_participant_context.sql.
-- The legacy freeform patients.medications TEXT column and patients.allergies (Participant
-- schema) are superseded by the structured tables below; left in place for now, not written
-- to by new code, and can be dropped in a later cleanup migration once callers migrate off.

BEGIN;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS gp_name TEXT,
    ADD COLUMN IF NOT EXISTS gp_phone TEXT,
    ADD COLUMN IF NOT EXISTS gp_practice TEXT;

CREATE TABLE IF NOT EXISTS public.medications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id     UUID NOT NULL,
    name                TEXT NOT NULL,
    strength            TEXT,
    route               TEXT NOT NULL DEFAULT 'oral'
                        CHECK (route IN ('oral', 'topical', 'injection', 'inhaled', 'sublingual', 'rectal', 'other')),
    dosage              TEXT,
    frequency_type      TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (frequency_type IN ('scheduled', 'prn')),
    scheduled_times     TEXT[] DEFAULT '{}',
    prescriber_name     TEXT,
    prescriber_contact  TEXT,
    start_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date            DATE,
    is_prn              BOOLEAN NOT NULL DEFAULT FALSE,
    prn_max_per_day     INTEGER,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'ceased', 'on_hold')),
    created_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medications_participant ON public.medications(participant_id);
CREATE INDEX IF NOT EXISTS idx_medications_org ON public.medications(organization_id);
CREATE INDEX IF NOT EXISTS idx_medications_active ON public.medications(participant_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.medication_administrations (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id               UUID NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
    shift_id                    UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
    participant_id              UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id             UUID NOT NULL,
    administered_by             UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    scheduled_time              TIMESTAMPTZ,
    administered_time           TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                      TEXT NOT NULL CHECK (status IN ('given', 'refused', 'missed', 'withheld')),
    dose_given                  TEXT,
    notes                       TEXT,
    prn_reason                  TEXT,
    prn_effect_observed         TEXT,
    voice_captured              BOOLEAN NOT NULL DEFAULT FALSE,
    corrects_administration_id  UUID REFERENCES public.medication_administrations(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_admin_medication ON public.medication_administrations(medication_id, administered_time DESC);
CREATE INDEX IF NOT EXISTS idx_medication_admin_participant ON public.medication_administrations(participant_id, administered_time DESC);
CREATE INDEX IF NOT EXISTS idx_medication_admin_shift ON public.medication_administrations(shift_id);
CREATE INDEX IF NOT EXISTS idx_medication_admin_org ON public.medication_administrations(organization_id);

CREATE OR REPLACE FUNCTION public.medication_administrations_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'medication_administrations rows are immutable; insert a correction row (corrects_administration_id) instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS medication_administrations_no_update ON public.medication_administrations;
CREATE TRIGGER medication_administrations_no_update
    BEFORE UPDATE OR DELETE ON public.medication_administrations
    FOR EACH ROW EXECUTE FUNCTION public.medication_administrations_prevent_modify();

ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_administrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medications' AND policyname = 'medications_service_role') THEN
        CREATE POLICY medications_service_role ON public.medications FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'medication_administrations' AND policyname = 'medication_administrations_service_role') THEN
        CREATE POLICY medication_administrations_service_role ON public.medication_administrations FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;