-- audit_service.log_action() has always been non-blocking by design (a
-- transient audit-log failure must never break the action it's logging),
-- but until now a failure was genuinely invisible - a warning-level log
-- line and nothing else. log_action() now returns True/False so a caller
-- can check whether its audit entry actually landed; this column is where
-- that "no, it didn't" gets recorded on the record itself, so it's
-- discoverable later without already knowing to go looking.
--
-- One column, same name, same meaning, across every table a caller from
-- this fix (and the evidence-upload fix alongside it) can set it on:
-- incidents, sessions, shifts, alerts, task_evidence_metadata.

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS audit_log_pending BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS audit_log_pending BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS audit_log_pending BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.alerts
    ADD COLUMN IF NOT EXISTS audit_log_pending BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.task_evidence_metadata
    ADD COLUMN IF NOT EXISTS audit_log_pending BOOLEAN NOT NULL DEFAULT false;

COMMIT;
