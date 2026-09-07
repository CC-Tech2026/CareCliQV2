-- A live schema investigation found sessions.patient_id had no foreign key
-- constraint - a session could reference a participant that doesn't exist,
-- with nothing in the database stopping it. Checking all seven tables that
-- conceptually use the legacy patient_id naming (rather than the newer
-- participant_id) directly against live constraints found:
--   MISSING:  sessions, plans, ai_summaries
--   ALREADY HAD IT:  alerts, practitioner_allocations, shift_activity_events,
--                     shift_checkins (each already has a real
--                     <table>_patient_id_fkey constraint)
-- So only the three below actually need one added here.
--
-- Verified live before this migration: sessions had 4 orphaned rows and
-- plans had 1 (its only row) referencing a patient_id that didn't exist
-- anywhere in patients, under any organization. Confirmed with the project
-- owner and deleted as stale/legacy demo data (all four sessions had no
-- worker_id, one carried a stray "legacy_" tag in its notes) before this
-- migration was written - not backfilled with a guess. ai_summaries had
-- zero rows, so no orphan check was needed there.
--
-- Naming is explicitly out of scope for this migration - patient_id stays
-- patient_id everywhere, this only adds the missing constraint.

BEGIN;

ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients(id);

ALTER TABLE public.plans
    ADD CONSTRAINT plans_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients(id);

ALTER TABLE public.ai_summaries
    ADD CONSTRAINT ai_summaries_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients(id);

COMMIT;
