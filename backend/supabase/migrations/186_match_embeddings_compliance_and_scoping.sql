-- ============================================================
-- match_session_embeddings / match_incident_embeddings —
-- compliance_status + participant/worker query-level scoping
-- ============================================================
-- Two independent fixes to the RAG retrieval RPCs:
--
-- 1. match_session_embeddings joined `sessions` for compliance_score but
--    never surfaced compliance_status alongside it, even though both live
--    on the same row. Consumers need the compliance outcome without a
--    second round trip.
--
-- 2. Neither RPC accepted any participant- or role-level restriction —
--    only organisation_id. A support worker's query and a coordinator's
--    query hit the exact same WHERE clause, relying entirely on the
--    caller to post-filter (or not). p_worker_ids / p_participant_ids
--    let the caller pass their effective scope (NULL = no restriction,
--    i.e. org-wide for coordinator/managing_director; a populated array
--    is the real gate for narrower roles) and have it enforced inside
--    the query itself, not applied to results afterward.
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
        WHERE p.proname IN ('match_session_embeddings', 'match_incident_embeddings')
          AND n.nspname = 'public'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.sig);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.match_session_embeddings(
    query_embedding   extensions.vector(1536),
    organisation_id   uuid,
    top_k             int DEFAULT 5,
    p_worker_ids      uuid[] DEFAULT NULL,
    p_participant_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
    content            text,
    session_id         uuid,
    participant_id     uuid,
    session_date       timestamptz,
    compliance_score   numeric,
    compliance_status  text,
    similarity_score   float
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
            s.compliance_score,
            s.compliance_status
        FROM public.session_embeddings se
        INNER JOIN public.sessions s ON s.id = se.session_id
        WHERE se.organization_id = match_session_embeddings.organisation_id
          AND (p_worker_ids IS NULL OR se.worker_id = ANY(p_worker_ids))
          AND (
              p_participant_ids IS NULL
              OR COALESCE(se.participant_id, s.patient_id) = ANY(p_participant_ids)
          )
    )
    SELECT
        oc.content,
        oc.session_id,
        oc.participant_id,
        oc.session_date,
        oc.compliance_score,
        oc.compliance_status,
        (1 - (oc.embedding <=> query_embedding))::float AS similarity_score
    FROM org_chunks oc
    ORDER BY oc.embedding <=> query_embedding
    LIMIT GREATEST(top_k, 0);
$$;

COMMENT ON FUNCTION public.match_session_embeddings IS
    'CARECLIQV2-82/Track B: HNSW cosine-similarity search over session_embeddings, org-scoped with session metadata (incl. compliance_status) and optional worker/participant query-level scoping.';

CREATE OR REPLACE FUNCTION public.match_incident_embeddings(
    query_embedding       extensions.vector(1536),
    match_threshold       float,
    match_count           int,
    p_org_id              uuid,
    p_exclude_incident_id uuid DEFAULT NULL,
    p_worker_ids          uuid[] DEFAULT NULL,
    p_participant_ids     uuid[] DEFAULT NULL
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
      AND (p_worker_ids IS NULL OR se.worker_id = ANY(p_worker_ids))
      AND (p_participant_ids IS NULL OR se.participant_id = ANY(p_participant_ids))
    ORDER BY se.embedding <=> query_embedding
    LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_incident_embeddings IS
    'CARECLIQV2-32/Track B: HNSW cosine-similarity search over incident embeddings, org-scoped with optional worker/participant query-level scoping.';

COMMIT;