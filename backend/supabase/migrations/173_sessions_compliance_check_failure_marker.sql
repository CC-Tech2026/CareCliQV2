-- Two places run the compliance rules engine and previously had no way to
-- record an unexpected failure: save_session_with_ai (backend/app/api/sessions.py)
-- and the shift-end background documentation check (backend/app/api/worker.py).
-- Both already handle the *expected* blocking-failure case correctly (a
-- deliberate rules_result snapshot is persisted); this covers the other
-- case - the engine or the AI call itself raising - which previously left
-- a session looking identical to "compliance check never run" instead of
-- "attempted and errored". Not written on success; only ever set to
-- "failed" when the marker below fires, so its mere presence already means
-- something went wrong.

BEGIN;

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS compliance_check_status TEXT,
    ADD COLUMN IF NOT EXISTS compliance_check_error TEXT;

COMMIT;
