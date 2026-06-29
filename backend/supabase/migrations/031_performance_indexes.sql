-- PRODUCTION READINESS — Performance indexes for coordinator queries
-- Addresses N+1 query patterns and slow list operations

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Shifts table: Additional composite indexes for common filter patterns
-- ─────────────────────────────────────────────────────────────────────────

-- For participant-centric queries (shift suggestions, history)
CREATE INDEX IF NOT EXISTS idx_shifts_org_participant_scheduled
    ON public.shifts (organization_id, participant_id, scheduled_start DESC)
    WHERE participant_id IS NOT NULL;

-- For status filtering (coordinator dashboard, calendar views)
CREATE INDEX IF NOT EXISTS idx_shifts_org_status_scheduled
    ON public.shifts (organization_id, status, scheduled_start DESC);

-- For date range queries (calendar, reporting)
CREATE INDEX IF NOT EXISTS idx_shifts_org_scheduled_range
    ON public.shifts (organization_id, scheduled_start, scheduled_end);

-- For live shift queries (clocked in, not clocked out)
CREATE INDEX IF NOT EXISTS idx_shifts_clocked_in_current
    ON public.shifts (organization_id, clocked_in_at, clocked_out_at, scheduled_start)
    WHERE clocked_in_at IS NOT NULL AND clocked_out_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Sessions table: Indexes for RAG and analytics queries
-- ─────────────────────────────────────────────────────────────────────────

-- For participant session history (shift analytics context retrieval)
CREATE INDEX IF NOT EXISTS idx_sessions_org_participant_date
    ON public.sessions (organization_id, participant_id, session_date DESC);

-- For compliance score filtering (reports, compliance dashboard)
CREATE INDEX IF NOT EXISTS idx_sessions_org_compliance_score
    ON public.sessions (organization_id, compliance_score DESC)
    WHERE compliance_score IS NOT NULL;

-- For shift linking (CARECLIQV2-35)
CREATE INDEX IF NOT EXISTS idx_sessions_org_shift_date
    ON public.sessions (organization_id, shift_id, session_date DESC)
    WHERE shift_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- AI Detected Patterns: Indexes for pattern detection service queries
-- ─────────────────────────────────────────────────────────────────────────

-- For risk pattern retrieval (shift suggestions risk flags)
CREATE INDEX IF NOT EXISTS idx_ai_patterns_org_participant_created
    ON public.ai_detected_patterns (organization_id, participant_id, created_at DESC)
    WHERE dismissed_at IS NULL;

-- For pattern type filtering (pattern analysis, audit)
CREATE INDEX IF NOT EXISTS idx_ai_patterns_org_type_date
    ON public.ai_detected_patterns (organization_id, pattern_type, created_at DESC)
    WHERE dismissed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Users and Patients: Support faster joins in shift listing
-- ─────────────────────────────────────────────────────────────────────────

-- For user lookup by org (used in shift worker joins)
CREATE INDEX IF NOT EXISTS idx_users_org_id
    ON public.users (organization_id, id)
    WHERE organization_id IS NOT NULL;

-- For patient lookup by org (used in shift participant joins)
CREATE INDEX IF NOT EXISTS idx_patients_org_id
    ON public.patients (organization_id, id)
    WHERE organization_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Session embeddings: For RAG semantic search
-- ─────────────────────────────────────────────────────────────────────────

-- Ensure pgvector HNSW index exists for similarity search
-- (Already created in earlier migrations, but verify)
CREATE INDEX IF NOT EXISTS idx_session_embeddings_hnsw
    ON public.session_embeddings USING hnsw (embedding vector_cosine_ops)
    WHERE organization_id IS NOT NULL;

COMMIT;

-- Index creation verification query (run after migration):
-- SELECT schemaname, tablename, indexname, indexdef 
-- FROM pg_indexes 
-- WHERE schemaname = 'public' 
--   AND tablename IN ('shifts', 'sessions', 'ai_detected_patterns', 'users', 'patients')
-- ORDER BY tablename, indexname;
