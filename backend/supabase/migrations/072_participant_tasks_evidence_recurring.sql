-- Add evidence tracking and recurring task support to participant_tasks
-- Required for NDIS compliance (evidence tracking for claims)
-- and task automation (recurring tasks for routine support)

BEGIN;

-- Add evidence_required column for tracking what evidence must be captured
ALTER TABLE public.participant_tasks
  ADD COLUMN IF NOT EXISTS evidence_required TEXT DEFAULT 'none'
    CHECK (evidence_required IN ('none', 'photo', 'notes', 'photo_and_notes')),
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS frequency_pattern TEXT
    CHECK (frequency_pattern IS NULL OR frequency_pattern IN (
      'every_morning_shift',
      'every_afternoon_shift',
      'every_night_shift',
      'daily_all_shifts',
      'specific_days_of_week',
      'custom'
    )),
  ADD COLUMN IF NOT EXISTS frequency_metadata JSONB;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_participant_tasks_evidence_required 
  ON public.participant_tasks (organization_id, evidence_required) 
  WHERE evidence_required != 'none';

CREATE INDEX IF NOT EXISTS idx_participant_tasks_is_recurring 
  ON public.participant_tasks (organization_id, is_recurring) 
  WHERE is_recurring = true;

CREATE INDEX IF NOT EXISTS idx_participant_tasks_status_recurring 
  ON public.participant_tasks (organization_id, status, is_recurring);

-- Add comments for documentation
COMMENT ON COLUMN public.participant_tasks.evidence_required IS 
  'NDIS compliance: Type of evidence required (photo, notes, both, or none) for task completion';
COMMENT ON COLUMN public.participant_tasks.is_recurring IS 
  'Whether this task repeats on a schedule (true) or is one-off (false)';
COMMENT ON COLUMN public.participant_tasks.frequency_pattern IS 
  'Pattern for recurring tasks: every_morning_shift, every_afternoon_shift, every_night_shift, daily_all_shifts, specific_days_of_week, or custom';
COMMENT ON COLUMN public.participant_tasks.frequency_metadata IS 
  'JSON metadata for frequency (e.g. days_of_week: [1,3,5] for Mon/Wed/Fri, or custom schedule details)';

COMMIT;
