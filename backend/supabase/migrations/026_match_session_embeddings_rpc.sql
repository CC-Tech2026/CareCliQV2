-- ============================================================
-- CARECLIQV2-30 — match_session_embeddings RPC
-- ============================================================
-- Exposes a Supabase RPC function for HNSW cosine-similarity
-- search over session_embeddings.  Organisation-id scoping is
-- enforced inside the function body so RLS on the table provides
-- an additional defence-in-depth layer.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_session_embeddings(
    query_embedding  extensions.vector(1536),
    match_threshold  float,
    match_count      int,
    p_org_id         uuid
)
RETURNS TABLE (
    id              uuid,
    session_id      uuid,
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
        se.participant_id,
        se.worker_id,
        se.chunk_index,
        se.content,
        se.metadata,
        (1 - (se.embedding <=> query_embedding))::float AS similarity
    FROM public.session_embeddings se
    WHERE se.organization_id = p_org_id
      AND (1 - (se.embedding <=> query_embedding)) >= match_threshold
    ORDER BY se.embedding <=> query_embedding
    LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_session_embeddings IS
    'CARECLIQV2-30: HNSW cosine-similarity search over session_embeddings, org-scoped.';

COMMIT;
