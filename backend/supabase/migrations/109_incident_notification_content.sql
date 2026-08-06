-- Incident Management spec — notification prep. Stores a snapshot of WHAT was submitted
-- to the NDIS Quality & Safeguards Commission, alongside the existing ndis_reported_at
-- (WHEN). The assembled content itself is computed client-side from fields the incident
-- record already has (title, description, practice_standard, participant_impact, etc.) —
-- no AI call, no new backend endpoint needed for that; this column just persists the
-- coordinator-reviewed/edited text at the moment they mark the incident reported.

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS ndis_notification_content TEXT;

COMMENT ON COLUMN public.incidents.ndis_notification_content IS
    'Snapshot of the NDIS Commission notification content as submitted, captured when
     ndis_reported_at is set. Editable by the coordinator before submission; immutable
     in spirit afterward (not DB-enforced, matches house style for this table).';

COMMIT;
