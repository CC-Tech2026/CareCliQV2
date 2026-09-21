-- CareCliQ: care coordinator on participants and shifts.
--
-- Distinct from the existing patients.case_manager_name/phone/email fields,
-- which are free text and already used as the NDIS plan-management billing
-- recipient in billing_service.py — left untouched. care_coordinator_id is
-- a structured reference to an internal user (support_coordinator or
-- managing_director), snapshotted onto shifts at creation time so it stays
-- accurate to who was responsible even if the participant's coordinator
-- later changes.

BEGIN;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS care_coordinator_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS care_coordinator_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_care_coordinator ON public.patients (care_coordinator_id);
CREATE INDEX IF NOT EXISTS idx_shifts_care_coordinator ON public.shifts (care_coordinator_id);

COMMIT;
