-- MD Documents & Audit Vault
--
-- Four tables backing the managing-director-only document vault:
--   governance_documents  — real org-level policy/procedure files (new store,
--                            nothing like it existed before). Soft-deleted
--                            only (deleted_at) — a policy document is itself
--                            audit history, unlike pre-hire applicant paperwork.
--   vault_share_events     — append-only chain-of-custody log for every
--                            "share with auditor" action (ZIP download or one
--                            of the email-compose buttons). Backs the Vault
--                            Home "shared with auditors in last 30 days" stat.
--   audit_pack_exports     — persists each on-demand audit pack the vault
--                            generates (same aggregation audit-pack.tsx
--                            already computes live, now stored once so the
--                            vault's Audit Packs folder lists real past packs
--                            instead of always being empty).
--   vault_share_links      — schema only, for a deferred phase-2 feature (an
--                            external no-login share link that will require a
--                            one-time emailed access code before any document
--                            is shown). No endpoints/UI reference this table
--                            yet; created now so phase 2 needs no migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.governance_documents (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    folder_key       TEXT        NOT NULL CHECK (folder_key IN (
                        'governance_operational', 'risk_management', 'quality_management',
                        'information_management', 'feedback_complaints', 'incident_management_system',
                        'human_resource_management', 'continuity_of_supports', 'emergency_disaster_management'
                     )),
    title            TEXT        NOT NULL,
    description      TEXT,
    file_path        TEXT        NOT NULL,
    file_url         TEXT,
    mime_type        TEXT,
    file_size_bytes  BIGINT,
    uploaded_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    version_label    TEXT,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_documents_org_folder
    ON public.governance_documents (organization_id, folder_key, created_at DESC)
    WHERE deleted_at IS NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'governance-documents',
    'governance-documents',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.governance_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'governance_documents'
        AND policyname = 'governance_documents_service_role'
    ) THEN
        CREATE POLICY governance_documents_service_role
        ON public.governance_documents
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


CREATE TABLE IF NOT EXISTS public.vault_share_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    shared_by         UUID        NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    share_method      TEXT        NOT NULL CHECK (share_method IN (
                        'download_zip', 'email_gmail', 'email_outlook', 'email_mailto'
                     )),
    folder_keys       TEXT[]      NOT NULL DEFAULT '{}',
    document_refs     JSONB       NOT NULL DEFAULT '[]',
    recipient_hint    TEXT,
    document_count    INTEGER     NOT NULL DEFAULT 0,
    ip_address        INET,
    user_agent        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_share_events_org_created
    ON public.vault_share_events (organization_id, created_at DESC);

ALTER TABLE public.vault_share_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vault_share_events'
        AND policyname = 'vault_share_events_service_role'
    ) THEN
        CREATE POLICY vault_share_events_service_role
        ON public.vault_share_events
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


CREATE TABLE IF NOT EXISTS public.audit_pack_exports (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    generated_by     UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    label            TEXT        NOT NULL,
    period_start     DATE,
    period_end       DATE,
    file_path        TEXT        NOT NULL,
    file_url         TEXT,
    file_size_bytes  BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_pack_exports_org_created
    ON public.audit_pack_exports (organization_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'audit-pack-files',
    'audit-pack-files',
    false,
    20971520,
    ARRAY['application/json']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.audit_pack_exports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'audit_pack_exports'
        AND policyname = 'audit_pack_exports_service_role'
    ) THEN
        CREATE POLICY audit_pack_exports_service_role
        ON public.audit_pack_exports
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- Deferred (phase 2) — schema only, no endpoints/UI reference this yet.
CREATE TABLE IF NOT EXISTS public.vault_share_links (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    created_by        UUID        NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    token             TEXT        NOT NULL UNIQUE,
    scope_folder_keys TEXT[]      DEFAULT '{}',
    document_refs     JSONB       NOT NULL DEFAULT '[]',
    recipient_email   TEXT        NOT NULL,
    requires_otp      BOOLEAN     NOT NULL DEFAULT true,
    otp_code_hash     TEXT,
    otp_expires_at    TIMESTAMPTZ,
    otp_attempts      INTEGER     NOT NULL DEFAULT 0,
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    last_accessed_at  TIMESTAMPTZ,
    access_count      INTEGER     NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_share_links_org
    ON public.vault_share_links (organization_id, created_at DESC);

ALTER TABLE public.vault_share_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vault_share_links'
        AND policyname = 'vault_share_links_service_role'
    ) THEN
        CREATE POLICY vault_share_links_service_role
        ON public.vault_share_links
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
