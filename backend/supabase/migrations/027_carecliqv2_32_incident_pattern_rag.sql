-- ============================================================
-- CARECLIQV2-32 — Incident pattern recognition RAG
-- ============================================================
-- Allows incident-only embeddings (no linked session) and adds
-- org-scoped RPC functions for incident similarity search.
-- ============================================================

BEGIN;

-- ── 1. incident_id column for standalone incident embeddings ────────────────

ALTER TABLE public.session_embeddings
    ADD COLUMN IF NOT EXISTS incident_id uuid;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_session_embeddings_incident'
    ) THEN
        ALTER TABLE public.session_embeddings
            ADD CONSTRAINT fk_session_embeddings_incident
            FOREIGN KEY (incident_id)
            REFERENCES public.incidents(id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE public.session_embeddings
    ALTER COLUMN session_id DROP NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_session_embeddings_parent'
    ) THEN
        ALTER TABLE public.session_embeddings
            ADD CONSTRAINT chk_session_embeddings_parent
            CHECK (session_id IS NOT NULL OR incident_id IS NOT NULL);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_embeddings_incident_chunk
    ON public.session_embeddings (incident_id, chunk_index)
    WHERE incident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_embeddings_incident_id
    ON public.session_embeddings (incident_id)
    WHERE incident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_embeddings_incident_source
    ON public.session_embeddings (organization_id, ((metadata->>'source')))
    WHERE metadata->>'source' = 'incident';

-- ── 2. Count distinct incidents in vector store (org-scoped) ────────────────

CREATE OR REPLACE FUNCTION public.count_incident_embeddings(p_org_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
    SELECT COUNT(DISTINCT COALESCE(
        se.incident_id,
        NULLIF(se.metadata->>'incident_id', '')::uuid
    ))::int
    FROM public.session_embeddings se
    WHERE se.organization_id = p_org_id
      AND se.metadata->>'source' = 'incident'
      AND COALESCE(
          se.incident_id,
          NULLIF(se.metadata->>'incident_id', '')::uuid
      ) IS NOT NULL;
$$;

COMMENT ON FUNCTION public.count_incident_embeddings IS
    'CARECLIQV2-32: Count distinct incidents embedded for an organisation.';

-- ── 3. Incident-specific similarity search ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.match_incident_embeddings(
    query_embedding       extensions.vector(1536),
    match_threshold       float,
    match_count           int,
    p_org_id              uuid,
    p_exclude_incident_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id              uuid,
    session_id      uuid,
    incident_id     uuid,
    participant_id  uuid,
    worker_id       uuid,
    chunk_index     int,
    content         text,
    metadata        jsonb,
    similarity      float
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
    SELECT
        se.id,
        se.session_id,
        se.incident_id,
        se.participant_id,
        se.worker_id,
        se.chunk_index,
        se.content,
        se.metadata,
        (1 - (se.embedding <=> query_embedding))::float AS similarity
    FROM public.session_embeddings se
    WHERE se.organization_id = p_org_id
      AND se.metadata->>'source' = 'incident'
      AND (1 - (se.embedding <=> query_embedding)) >= match_threshold
      AND (
          p_exclude_incident_id IS NULL
          OR COALESCE(
              se.incident_id,
              NULLIF(se.metadata->>'incident_id', '')::uuid
          ) IS DISTINCT FROM p_exclude_incident_id
      )
    ORDER BY se.embedding <=> query_embedding
    LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_incident_embeddings IS
    'CARECLIQV2-32: HNSW cosine-similarity search over incident embeddings, org-scoped.';

COMMIT;
