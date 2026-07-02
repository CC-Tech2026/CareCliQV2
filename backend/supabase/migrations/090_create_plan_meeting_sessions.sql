-- Migration 090: Create plan_meeting_sessions table
-- Purpose: Store two-stage LLM processing results for plan meeting recordings
-- Implements Stage 1 (name resolution) and Stage 2 (goal extraction)

-- Migration 090: Create plan_meeting_sessions table
-- Purpose: Store two-stage LLM processing results for plan meeting recordings
-- Implements Stage 1 (name resolution) and Stage 2 (goal extraction)
-- NOTE: Adapted to current schema:
--   organizations.organization_id, users.id, patients.id

BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_meeting_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core foreign keys
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    coordinator_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    participant_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,  -- Resolved after Stage 1

    -- Session metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    recorded_at TIMESTAMP WITH TIME ZONE,
    meeting_type VARCHAR(50) DEFAULT 'standard',  -- e.g., 'standard', 'review', 'emergency'
    conversation_context JSONB,  -- Additional context about the meeting

    -- Stage 1: Transcription + Name Resolution
    stage_1_status VARCHAR(20) DEFAULT 'pending',  -- pending | in-progress | complete | error
    stage_1_completed_at TIMESTAMP WITH TIME ZONE,
    stage_1_error TEXT,

    raw_transcript TEXT,      -- Raw Whisper output with speaker labels
    clean_transcript JSONB,   -- [{segment_id, speaker_name, text, start_time}]
    resolved_names JSONB,     -- {Speaker A -> {name, confidence, role}}
    name_confidence FLOAT,    -- Average confidence across resolved speakers

    -- Stage 2: Goal + Task Extraction
    stage_2_status VARCHAR(20) DEFAULT 'pending',  -- pending | in-progress | complete | error
    stage_2_completed_at TIMESTAMP WITH TIME ZONE,
    stage_2_error TEXT,

    extracted_goals JSONB,    -- [{goal_id, category, description, confidence, source_segment_ids}]
    extracted_tasks JSONB,    -- [{task_id, category, frequency, support_type, confidence}]
    goal_confidence FLOAT,    -- Average confidence of extracted goals

    -- Attention flags from LLM processing
    attention_flags JSONB,    -- [{flag_type, severity, description}]

    -- Review + approval workflow
    review_status VARCHAR(20) DEFAULT 'pending',  -- pending | in-review | approved | rejected
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,

    -- Constraints
    CONSTRAINT valid_stage_1_status CHECK (stage_1_status IN ('pending', 'in-progress', 'complete', 'error')),
    CONSTRAINT valid_stage_2_status CHECK (stage_2_status IN ('pending', 'in-progress', 'complete', 'error')),
    CONSTRAINT valid_review_status CHECK (review_status IN ('pending', 'in-review', 'approved', 'rejected'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES: Optimized for querying by org + stage status
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_plan_meeting_sessions_org_stage1
    ON public.plan_meeting_sessions(organization_id, stage_1_status)
    WHERE stage_1_status != 'complete';

CREATE INDEX IF NOT EXISTS idx_plan_meeting_sessions_org_stage2
    ON public.plan_meeting_sessions(organization_id, stage_2_status)
    WHERE stage_2_status != 'complete';

CREATE INDEX IF NOT EXISTS idx_plan_meeting_sessions_org_review
    ON public.plan_meeting_sessions(organization_id, review_status)
    WHERE review_status IN ('pending', 'in-review');

CREATE INDEX IF NOT EXISTS idx_plan_meeting_sessions_coordinator
    ON public.plan_meeting_sessions(coordinator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_meeting_sessions_participant
    ON public.plan_meeting_sessions(participant_id)
    WHERE participant_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY: Coordinator can access their organization's sessions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.plan_meeting_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Coordinators can view/edit sessions from their organization
DROP POLICY IF EXISTS coordinator_plan_meeting_sessions ON public.plan_meeting_sessions;
CREATE POLICY coordinator_plan_meeting_sessions ON public.plan_meeting_sessions
    FOR ALL
    USING (organization_id = cs_user_org_id())
    WITH CHECK (organization_id = cs_user_org_id());

-- Policy: Participants can view their own sessions
DROP POLICY IF EXISTS participant_plan_meeting_sessions ON public.plan_meeting_sessions;
CREATE POLICY participant_plan_meeting_sessions ON public.plan_meeting_sessions
    FOR SELECT
    USING (
        participant_id IN (
            SELECT p.id
            FROM public.patients p
            WHERE p.user_id = auth.uid()
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMENTS: Documentation for schema
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.plan_meeting_sessions IS
    'Two-stage LLM processing for plan meeting audio recordings. Stage 1 resolves speaker identities and cleans transcript. Stage 2 extracts NDIS goals and core support tasks.';

COMMENT ON COLUMN public.plan_meeting_sessions.stage_1_status IS
    'Stage 1: Transcribe audio + resolve speaker names. Status: pending -> in-progress -> complete (or error).';

COMMENT ON COLUMN public.plan_meeting_sessions.stage_2_status IS
    'Stage 2: Extract NDIS goals and support tasks. Status: pending -> in-progress -> complete (or error).';

COMMENT ON COLUMN public.plan_meeting_sessions.clean_transcript IS
    'JSON array of transcript segments with speaker name, text, segment_id. Segments are used as citations in Stage 2 goal extraction.';

COMMENT ON COLUMN public.plan_meeting_sessions.resolved_names IS
    'Speaker label -> resolved name mapping: {Speaker A -> {name, confidence: confirmed|likely|uncertain, role}}';

COMMENT ON COLUMN public.plan_meeting_sessions.extracted_goals IS
    'NDIS goals extracted from clean transcript, each with source_segment_ids for traceability.';

COMMENT ON COLUMN public.plan_meeting_sessions.extracted_tasks IS
    'Core support tasks extracted from clean transcript, related to extracted goals.';

COMMENT ON COLUMN public.plan_meeting_sessions.attention_flags IS
    'LLM-identified safety concerns, ambiguities, or processing issues requiring coordinator review.';

COMMIT;

-----------------------------------------------------------------------------------------------------------------------------------------------------------------------
----Verify table, indexes, and policies are all in place---------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------
with t as (
  select 'table'::text as object_type, c.relname as object_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'plan_meeting_sessions'
), i as (
  select 'index'::text as object_type, c.relname as object_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'i' and c.relname in (
    'idx_plan_meeting_sessions_org_stage1',
    'idx_plan_meeting_sessions_org_stage2',
    'idx_plan_meeting_sessions_org_review',
    'idx_plan_meeting_sessions_coordinator',
    'idx_plan_meeting_sessions_participant'
  )
), p as (
  select 'policy'::text as object_type, policyname as object_name
  from pg_policies
  where schemaname = 'public' and tablename = 'plan_meeting_sessions'
    and policyname in ('coordinator_plan_meeting_sessions','participant_plan_meeting_sessions')
)
select * from t
union all
select * from i
union all
select * from p
order by object_type, object_name;