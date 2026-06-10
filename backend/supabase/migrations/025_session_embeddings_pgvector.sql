-- ============================================================
-- CARECLIQV2-29 — session_embeddings with pgvector
-- ============================================================
-- Enables the pgvector extension and recreates session_embeddings
-- for chunk-level RAG storage with native vector(1536) embeddings,
-- HNSW cosine-similarity indexing, and organisation-scoped RLS.
-- ============================================================

BEGIN;

-- ── 1. pgvector extension ───────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── 2. Drop legacy session_embeddings (JSONB, one-row-per-session) ──────────

DROP TRIGGER IF EXISTS trg_session_embeddings_updated_at ON public.session_embeddings;
DROP FUNCTION IF EXISTS public.set_session_embeddings_updated_at();
DROP TABLE IF EXISTS public.session_embeddings;

-- ── 3. session_embeddings — chunk-level vector store ────────────────────────

CREATE TABLE public.session_embeddings (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid            NOT NULL,
    session_id      uuid            NOT NULL,
    participant_id  uuid,
    worker_id       uuid,
    chunk_index     integer         NOT NULL DEFAULT 0,
    content         text,
    embedding       extensions.vector(1536) NOT NULL,
    metadata        jsonb           NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_session_embeddings_session
        FOREIGN KEY (session_id)
        REFERENCES public.sessions(id) ON DELETE CASCADE,

    CONSTRAINT fk_session_embeddings_org
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations(organization_id) ON DELETE RESTRICT,

    CONSTRAINT fk_session_embeddings_participant
        FOREIGN KEY (participant_id)
        REFERENCES public.patients(id) ON DELETE SET NULL,

    CONSTRAINT fk_session_embeddings_worker
        FOREIGN KEY (worker_id)
        REFERENCES public.users(id) ON DELETE SET NULL,

    CONSTRAINT uq_session_embeddings_session_chunk
        UNIQUE (session_id, chunk_index)
);

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX idx_session_embeddings_organization_id
    ON public.session_embeddings(organization_id);

CREATE INDEX idx_session_embeddings_session_id
    ON public.session_embeddings(session_id);

CREATE INDEX idx_session_embeddings_org_id
    ON public.session_embeddings(organization_id, id);

CREATE INDEX idx_session_embeddings_embedding_hnsw
    ON public.session_embeddings
    USING hnsw (embedding extensions.vector_cosine_ops);

-- ── 5. RLS — organisation-scoped reads; service role writes ───────────────────

ALTER TABLE public.session_embeddings ENABLE ROW LEVEL SECURITY;

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
