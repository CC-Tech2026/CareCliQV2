-- Worker-facing policy reading + acknowledgement, plus the branded
-- template/editor pipeline that authors governance_documents in-app.
--
-- governance_documents (migration 164) already stores real org policy
-- files with a supersede-based version chain, but every route touching it
-- is managing_director-only (md_vault.py) — a worker has never had any way
-- to read or acknowledge one. This adds:
--
--   governance_documents.visible_to_workers — per-document opt-in flag (not
--     every one of the 9 governance categories should default to all-staff
--     visible, e.g. human_resource_management may hold internal-only files).
--
--   policy_acknowledgements — mirrors worker_safety_acknowledgements
--     (migration 056) exactly: a permanent, timestamped, per-worker record
--     of having acknowledged a specific document.
--
--   organization_document_templates — an org's own branded HTML/Jinja2
--     letterhead template (title/body placeholders), so a policy can be
--     authored in-app instead of only ever uploaded as a finished file.
--
--   policy_documents — the editable authoring wrapper: title/category/body
--     content plus which template to render it through. "Publish" renders
--     content_html into the template via Jinja2+WeasyPrint (same engine
--     already used for invoices) and calls the existing
--     upload_governance_document()/supersede path — nothing about
--     governance_documents' own versioning changes.

BEGIN;

ALTER TABLE public.governance_documents
    ADD COLUMN IF NOT EXISTS visible_to_workers BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_governance_documents_worker_visible
    ON public.governance_documents (organization_id, visible_to_workers)
    WHERE deleted_at IS NULL AND superseded_at IS NULL AND visible_to_workers = true;

CREATE TABLE IF NOT EXISTS public.policy_acknowledgements (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    document_id      UUID        NOT NULL REFERENCES public.governance_documents(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT policy_acknowledgements_unique UNIQUE (worker_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_acknowledgements_worker
    ON public.policy_acknowledgements (worker_id, document_id);

CREATE INDEX IF NOT EXISTS idx_policy_acknowledgements_document
    ON public.policy_acknowledgements (document_id);

COMMENT ON TABLE public.policy_acknowledgements IS
    'Timestamped worker acknowledgement of a specific governance_documents version.';

ALTER TABLE public.policy_acknowledgements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'policy_acknowledgements'
          AND policyname = 'policy_acknowledgements_service_role'
    ) THEN
        CREATE POLICY policy_acknowledgements_service_role
        ON public.policy_acknowledgements
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


CREATE TABLE IF NOT EXISTS public.organization_document_templates (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    description      TEXT,
    html_content     TEXT        NOT NULL,
    is_default       BOOLEAN     NOT NULL DEFAULT false,
    created_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_document_templates_org
    ON public.organization_document_templates (organization_id, created_at DESC);

ALTER TABLE public.organization_document_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'organization_document_templates'
          AND policyname = 'organization_document_templates_service_role'
    ) THEN
        CREATE POLICY organization_document_templates_service_role
        ON public.organization_document_templates
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


CREATE TABLE IF NOT EXISTS public.policy_documents (
    id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id               UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    folder_key                    TEXT        NOT NULL CHECK (folder_key IN (
                                     'governance_operational', 'risk_management', 'quality_management',
                                     'information_management', 'feedback_complaints', 'incident_management_system',
                                     'human_resource_management', 'continuity_of_supports', 'emergency_disaster_management'
                                  )),
    title                         TEXT        NOT NULL,
    template_id                   UUID        REFERENCES public.organization_document_templates(id) ON DELETE SET NULL,
    content_html                  TEXT        NOT NULL DEFAULT '',
    visible_to_workers            BOOLEAN     NOT NULL DEFAULT false,
    current_governance_document_id UUID       REFERENCES public.governance_documents(id) ON DELETE SET NULL,
    created_by                    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_documents_org
    ON public.policy_documents (organization_id, updated_at DESC);

ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'policy_documents'
          AND policyname = 'policy_documents_service_role'
    ) THEN
        CREATE POLICY policy_documents_service_role
        ON public.policy_documents
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
