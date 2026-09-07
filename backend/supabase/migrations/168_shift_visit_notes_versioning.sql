-- Version history + real-time relevance/appropriateness validation for
-- shift_visit_notes (per-task quick notes). Mirrors the superseded-chain
-- pattern already used by governance_documents (167_governance_document_versions.sql)
-- and medication_documents.superseded_by_document_id -- editing a note inserts
-- a new row and marks the previous one as superseded, instead of UPDATE-in-place.
--
-- No RLS/policy changes here: this table already has RLS enabled since
-- 140_enable_missing_tenant_rls.sql, with a service_role all-access policy
-- plus an authenticated coordinator/MD-scoped SELECT policy added in
-- 153_coordinator_live_realtime_rls.sql (it's also already in the
-- supabase_realtime publication for live coordinator monitoring) -- adding
-- nullable columns doesn't affect any of that.

BEGIN;

ALTER TABLE public.shift_visit_notes
    ADD COLUMN IF NOT EXISTS superseded_by_note_id UUID
        REFERENCES public.shift_visit_notes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_original BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_during_shift BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS validation_result JSONB,
    ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shift_visit_notes_superseded_by
    ON public.shift_visit_notes (superseded_by_note_id);

COMMIT;
