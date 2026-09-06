-- Immutable version history for the structured per-session note fields on
-- public.sessions (notes, activities_performed, outcomes, participant_response,
-- progress_toward_goals, support_category). Unlike shift_visit_notes, sessions
-- rows are referenced by FK from shifts/messages/shift_visit_notes/
-- restrictive_practice_flags etc, so we cannot insert a new sessions row per
-- edit (would break every relationship) -- this dedicated table snapshots
-- each version instead, following the same superseded_by/superseded_at chain
-- shape as governance_documents (167_governance_document_versions.sql).
--
-- service_role-only RLS: nothing needs direct/realtime client reads of this
-- table, all reads go through a backend endpoint (unlike shift_visit_notes,
-- which coordinator-live realtime subscribes to directly).

BEGIN;

CREATE TABLE IF NOT EXISTS public.session_note_versions (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    session_id                UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    notes                     TEXT,
    activities_performed      TEXT,
    outcomes                  TEXT,
    participant_response      TEXT,
    progress_toward_goals     TEXT,
    support_category          TEXT,
    validation_result         JSONB,
    is_original                BOOLEAN     NOT NULL DEFAULT true,
    created_during_shift       BOOLEAN     NOT NULL DEFAULT true,
    edited_by                  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    superseded_by_version_id   UUID        REFERENCES public.session_note_versions(id) ON DELETE SET NULL,
    superseded_at              TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_note_versions_session
    ON public.session_note_versions (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_note_versions_superseded_by
    ON public.session_note_versions (superseded_by_version_id);

ALTER TABLE public.session_note_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'session_note_versions'
        AND policyname = 'session_note_versions_service_role'
    ) THEN
        CREATE POLICY session_note_versions_service_role
        ON public.session_note_versions
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
