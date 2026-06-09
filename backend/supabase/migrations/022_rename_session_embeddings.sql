-- ============================================================
-- CCQ-106 — Create session_embeddings table
-- ============================================================
-- Creates session_embeddings as a first-class table (not a rename
-- of note_embeddings). Stores one embedding vector per session,
-- scoped to organization_id for org-isolated RAG retrieval.
--
-- Columns:
--   id               — surrogate PK
--   session_id       — FK → sessions(id), unique (one row per session)
--   organization_id  — FK → organizations(organization_id), NOT NULL
--   embedding        — JSONB float array (1536 dims, text-embedding-3-small)
--   model            — embedding model name for future versioning
--   created_at       — insertion timestamp
--   updated_at       — last upsert timestamp
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.session_embeddings (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid        NOT NULL,
    organization_id uuid        NOT NULL,
    embedding       jsonb       NOT NULL,
    model           text        NOT NULL DEFAULT 'text-embedding-3-small',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_session_embeddings_session
        FOREIGN KEY (session_id)
        REFERENCES public.sessions(id) ON DELETE CASCADE,

    CONSTRAINT fk_session_embeddings_org
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations(organization_id) ON DELETE RESTRICT,

    -- One embedding row per session; upsert on session_id is the write pattern.
    CONSTRAINT uq_session_embeddings_session_id UNIQUE (session_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_session_embeddings_session_id
    ON public.session_embeddings(session_id);

CREATE INDEX IF NOT EXISTS idx_session_embeddings_organization_id
    ON public.session_embeddings(organization_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_session_embeddings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_embeddings_updated_at ON public.session_embeddings;
CREATE TRIGGER trg_session_embeddings_updated_at
    BEFORE UPDATE ON public.session_embeddings
    FOR EACH ROW EXECUTE FUNCTION public.set_session_embeddings_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.session_embeddings ENABLE ROW LEVEL SECURITY;

-- Authenticated reads are always org-scoped (CCQ-106 AC)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'session_embeddings' AND policyname = 'session_embeddings_org_select'
    ) THEN
        CREATE POLICY session_embeddings_org_select ON public.session_embeddings
        FOR SELECT TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- Python backend uses the service-role admin client for all writes
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'session_embeddings' AND policyname = 'session_embeddings_service_role'
    ) THEN
        CREATE POLICY session_embeddings_service_role ON public.session_embeddings
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    END IF;
END $$;

COMMIT;
