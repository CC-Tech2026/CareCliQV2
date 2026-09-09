-- Merge-field foundation for the branded document-template pipeline
-- (migration 191). A template's html_content can now declare which
-- namespaced data it expects beyond the org letterhead — 'participant' or
-- 'worker' — via merge_scope. 'organisation' (the default, and the only
-- scope any render path actually consumes yet) is unchanged behaviour for
-- every existing template. 'participant'/'worker' are modelled now so a
-- future record-bound document-generation feature can pick a scoped
-- template and require the matching id, without another migration.

BEGIN;

ALTER TABLE public.organization_document_templates
    ADD COLUMN IF NOT EXISTS merge_scope TEXT NOT NULL DEFAULT 'organisation'
    CHECK (merge_scope IN ('organisation', 'participant', 'worker'));

COMMIT;
