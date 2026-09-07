-- Evidence chain-of-custody coverage, extended beyond the task-evidence flow to medication
-- documents (prescriptions, plans, high-risk administration verification photos) and incident
-- photos (compliance_evidence_service.record_file_evidence_metadata, wired into
-- medication_document_service.upload_document and incident_service._upload_incident_photos).
--
-- task_evidence_metadata.session_id and evidence_access_audit_log.session_id were NOT NULL,
-- correct when the only evidence source was the session-scoped task-evidence composer. A
-- medication document (e.g. a prescription uploaded by a coordinator outside any shift) or a
-- coordinator-created incident report may have no session at all — only shift_id, itself
-- already nullable since 058_compliance_privacy_signature.sql. Relaxing session_id to nullable
-- is additive only: every existing row already has a real session_id and keeps it.

BEGIN;

ALTER TABLE public.task_evidence_metadata
    ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE public.evidence_access_audit_log
    ALTER COLUMN session_id DROP NOT NULL;

COMMIT;
