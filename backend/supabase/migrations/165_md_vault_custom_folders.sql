-- MD Documents & Audit Vault: custom folders + persisted folder ordering
--
-- Lets an MD add their own ad hoc folders to the vault (alongside the 17
-- built-in categories), and lets them drag-reorder the folder grid, with
-- that order remembered per organisation rather than resetting every visit.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vault_custom_folders (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    label            TEXT        NOT NULL,
    description      TEXT,
    folder_group     TEXT        NOT NULL DEFAULT 'record'
                     CHECK (folder_group IN ('record', 'governance')),
    created_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_custom_folders_org
    ON public.vault_custom_folders (organization_id, created_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE public.vault_custom_folders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vault_custom_folders'
        AND policyname = 'vault_custom_folders_service_role'
    ) THEN
        CREATE POLICY vault_custom_folders_service_role
        ON public.vault_custom_folders
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


CREATE TABLE IF NOT EXISTS public.vault_custom_folder_documents (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id        UUID        NOT NULL REFERENCES public.vault_custom_folders(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    title            TEXT        NOT NULL,
    file_path        TEXT        NOT NULL,
    file_url         TEXT,
    mime_type        TEXT,
    file_size_bytes  BIGINT,
    uploaded_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_custom_folder_documents_folder
    ON public.vault_custom_folder_documents (folder_id, created_at DESC)
    WHERE deleted_at IS NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vault-custom-files',
    'vault-custom-files',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.vault_custom_folder_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vault_custom_folder_documents'
        AND policyname = 'vault_custom_folder_documents_service_role'
    ) THEN
        CREATE POLICY vault_custom_folder_documents_service_role
        ON public.vault_custom_folder_documents
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- One row per folder key (built-in category key, or "custom:<uuid>") per
-- org — lets the MD drag-reorder the folder grid and have it stick.
CREATE TABLE IF NOT EXISTS public.vault_folder_layout (
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    folder_key       TEXT        NOT NULL,
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, folder_key)
);

ALTER TABLE public.vault_folder_layout ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vault_folder_layout'
        AND policyname = 'vault_folder_layout_service_role'
    ) THEN
        CREATE POLICY vault_folder_layout_service_role
        ON public.vault_folder_layout
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
