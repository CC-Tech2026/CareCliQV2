-- Embedding generation for session notes and incident reports runs
-- automatically on save/edit (see backend/app/services/embedding_pipeline.py)
-- but previously had no way to record an unexpected failure — a note could
-- silently end up permanently missing from semantic search, or stale after
-- an edit, with nothing showing either happened. Mirrors the pattern from
-- 173_sessions_compliance_check_failure_marker.sql: not written on success;
-- only ever set to "failed" when generation genuinely fails, so its mere
-- presence already means something went wrong.

BEGIN;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS embedding_status TEXT,
    ADD COLUMN IF NOT EXISTS embedding_error TEXT;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS embedding_status TEXT,
    ADD COLUMN IF NOT EXISTS embedding_error TEXT;

COMMIT;
