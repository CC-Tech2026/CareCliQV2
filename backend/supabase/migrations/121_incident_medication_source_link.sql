-- Medication Safety Addendum step 5: cross-link a medication event into Incident Management
-- so a genuine error or a concerning refused/missed pattern never lives only as a medication
-- record. source_type/source_id follow the same precedent as incidents.shift_id
-- (041_shift_workflow_carecliqv2.sql) — a plain linkage column, not a foreign key to a
-- polymorphic target, since source_type varies what source_id points at.
--
-- refused_missed_triggered and worst_medication_id are net new: the existing `triggered`
-- boolean on medication_pattern_signals conflates two different conditions (a general
-- late/early/missed rate threshold, and a refused/missed concentration on one specific
-- medication) into one flag. The incident trigger must fire only on the second, specific
-- condition — a rate trend is worth a coordinator's review in the Compliance Centre, but is
-- not on its own a safety incident the way a concentrated refusal/missed pattern is.

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS source_type TEXT,
    ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS idx_incidents_source
    ON public.incidents (source_type, source_id)
    WHERE source_type IS NOT NULL;

ALTER TABLE public.medication_pattern_signals
    ADD COLUMN IF NOT EXISTS refused_missed_triggered BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS worst_medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL;

COMMIT;
