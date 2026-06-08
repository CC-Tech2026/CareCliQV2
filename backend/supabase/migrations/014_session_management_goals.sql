-- SCRUM-164 Session Management — Goals & Choice/Control schema extensions
-- Stories: SCRUM-145, SCRUM-255 (rich goal context), SCRUM-226 (structured session goals),
--          SCRUM-227 (participant choice & control)

-- -----------------------------------------------------------------------
-- Extend patient_goals with rich context columns (SCRUM-145, SCRUM-255)
-- -----------------------------------------------------------------------

ALTER TABLE public.patient_goals
  ADD COLUMN IF NOT EXISTS title             TEXT,
  ADD COLUMN IF NOT EXISTS why_it_matters    TEXT,
  ADD COLUMN IF NOT EXISTS worker_focus      JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority          INTEGER  DEFAULT 99,
  ADD COLUMN IF NOT EXISTS category         TEXT     DEFAULT 'general';

-- Back-fill title from description where null
UPDATE public.patient_goals
SET title = description
WHERE title IS NULL AND description IS NOT NULL;

-- -----------------------------------------------------------------------
-- Extend sessions (SCRUM-226, SCRUM-227)
-- -----------------------------------------------------------------------

-- Per-goal structured documentation: [{goal_id, goal_title, evidence_provided, outcome, observation}]
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS goal_progress_notes     JSONB DEFAULT '[]'::jsonb;

-- Participant choice & control narrative (SCRUM-227)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS participant_choice_control TEXT;

-- -----------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------

-- Ensure status column exists before indexing (may be absent on older DB instances)
ALTER TABLE public.patient_goals
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_patient_goals_active_priority
  ON public.patient_goals (plan_id, priority ASC);
