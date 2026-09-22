-- "Fill it later" — defer the long written-summary fields on Log Incident (description,
-- participant_impact, worker_actions, injury_nature) instead of blocking submission on them.
-- A deferred incident gets a 6-hour window; the worker is nudged hourly, and if the window
-- lapses without completion, escalation goes to the org's coordinators/MD instead (mirrors
-- overdue_documentation_escalation_service.py's shift-documentation pattern).

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS pending_fields TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS pending_deadline_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pending_last_reminded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pending_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pending_escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.incidents.pending_fields IS
    'Subset of description, participant_impact, worker_actions, injury_nature deferred via
     "Fill it later" at submission time. Emptied (not the row deleted) once the worker completes
     them through PATCH /api/incidents/{id}/complete-pending.';
COMMENT ON COLUMN public.incidents.pending_deadline_at IS
    'Set at creation to created_at + 6 hours when pending_fields is non-empty. Past this with
     pending_fields still non-empty triggers coordinator/MD escalation instead of further
     worker reminders.';
COMMENT ON COLUMN public.incidents.pending_last_reminded_at IS
    'Last time the worker was nudged about pending fields; the hourly pass only re-notifies
     once at least an hour has elapsed since this.';
COMMENT ON COLUMN public.incidents.pending_completed_at IS
    'Set once all deferred fields are filled in (pending_fields becomes empty).';
COMMENT ON COLUMN public.incidents.pending_escalated_at IS
    'Set once when pending_deadline_at passes with fields still outstanding — escalation to
     coordinators fires once per incident, not on every pass.';

CREATE INDEX IF NOT EXISTS idx_incidents_pending_fields
    ON public.incidents (pending_deadline_at)
    WHERE array_length(pending_fields, 1) > 0;

COMMIT;
