-- 089: Participant plan meetings
-- Coordinator-recorded notes from care plan conversations with participants/nominees.
-- AI analyses the notes and suggests goals and tasks, scoped to Core supports only.

BEGIN;

-- Use DO blocks so the migration is safe to re-run if it previously failed mid-way.
DO $$ BEGIN
  CREATE TYPE public.plan_meeting_type AS ENUM (
    'plan_review',
    'initial_setup',
    'check_in',
    'incident_followup',
    'goal_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.plan_meeting_suggestions_status AS ENUM (
    'pending_review',
    'reviewed',
    'applied'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.participant_plan_meetings (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id           UUID        NOT NULL REFERENCES public.patients(id)                ON DELETE CASCADE,
  organization_id          UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
  coordinator_id           UUID        NOT NULL REFERENCES public.users(id)                   ON DELETE RESTRICT,

  -- Meeting details
  meeting_date             DATE        NOT NULL,
  meeting_type             public.plan_meeting_type NOT NULL DEFAULT 'check_in',
  attendees                TEXT[]      NOT NULL DEFAULT '{}',

  -- Coordinator-entered notes (structured)
  conversation_notes       TEXT,           -- full free-text notes from the meeting
  participant_priorities   TEXT,           -- participant's own words: what they want support with
  coordinator_observations TEXT,           -- clinical/practical observations
  agreed_outcomes          TEXT,           -- what was agreed / action items

  -- AI suggestion payload
  ai_suggestions_raw       JSONB,          -- full AI response (goals, tasks, flags, reasoning)
  suggestions_accepted     JSONB,          -- what the coordinator actually accepted
  suggestions_status       public.plan_meeting_suggestions_status NOT NULL DEFAULT 'pending_review',
  ai_generated_at          TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_plan_meetings_participant
  ON public.participant_plan_meetings (participant_id, meeting_date DESC);

CREATE INDEX IF NOT EXISTS idx_plan_meetings_org_pending
  ON public.participant_plan_meetings (organization_id, suggestions_status)
  WHERE suggestions_status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_plan_meetings_coordinator
  ON public.participant_plan_meetings (coordinator_id, created_at DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_plan_meeting_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_meeting_updated_at ON public.participant_plan_meetings;
CREATE TRIGGER trg_plan_meeting_updated_at
  BEFORE UPDATE ON public.participant_plan_meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_plan_meeting_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.participant_plan_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_meetings_org_isolation ON public.participant_plan_meetings;
CREATE POLICY plan_meetings_org_isolation ON public.participant_plan_meetings
  FOR ALL
  USING (organization_id = cs_user_org_id())
  WITH CHECK (organization_id = cs_user_org_id());

COMMIT;
