-- Medication Management v1 step 4 (PRN): relax medication_administrations immutability to
-- permit exactly the one follow-up documented in the spec — a worker logging
-- prn_effect_observed (and the voice_captured flag alongside it) later in the same shift,
-- after the initial "given" row was already created. Every other column stays immutable;
-- any other change still raises, same as before. Corrections for anything else are still
-- new rows via corrects_administration_id.

BEGIN;

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
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.dose_given IS DISTINCT FROM OLD.dose_given
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.prn_reason IS DISTINCT FROM OLD.prn_reason
        OR NEW.corrects_administration_id IS DISTINCT FROM OLD.corrects_administration_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'medication_administrations rows are immutable except the prn_effect_observed/voice_captured follow-up; insert a correction row instead';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
