-- ============================================================
-- CARECLIQV2-82 — match_session_embeddings RPC (v2)
-- ============================================================
-- Replaces the v1 signature with organisation_id + top_k params,
-- joins sessions for metadata enrichment, and applies the org filter
-- before vector ranking via a CTE.
-- ============================================================

BEGIN;

DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'match_session_embeddings'
          AND n.nspname = 'public'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.sig);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.match_session_embeddings(
    query_embedding  extensions.vector(1536),
    organisation_id  uuid,
    top_k            int DEFAULT 5
)
RETURNS TABLE (
    content          text,
    session_id       uuid,
    participant_id   uuid,
    session_date     timestamptz,
    compliance_score numeric,
    similarity_score float
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
    WITH org_chunks AS (
        SELECT
            se.embedding,
            se.content,
            se.session_id,
            COALESCE(se.participant_id, s.patient_id) AS participant_id,
            s.session_date,
            s.compliance_score
        FROM public.session_embeddings se
        INNER JOIN public.sessions s ON s.id = se.session_id
        WHERE se.organization_id = match_session_embeddings.organisation_id
    )
    SELECT
        oc.content,
        oc.session_id,
        oc.participant_id,
        oc.session_date,
        oc.compliance_score,
        (1 - (oc.embedding <=> query_embedding))::float AS similarity_score
    FROM org_chunks oc
    ORDER BY oc.embedding <=> query_embedding
    LIMIT GREATEST(top_k, 0);
$$;

COMMENT ON FUNCTION public.match_session_embeddings IS
    'CARECLIQV2-82: HNSW cosine-similarity search over session_embeddings, org-scoped with session metadata.';

COMMIT;
