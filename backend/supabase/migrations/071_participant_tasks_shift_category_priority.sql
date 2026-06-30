-- Add shift type, category, and priority to participant_tasks for proper task management and invoicing
-- This enables granular task classification needed for shift-based assignment and billing

ALTER TABLE participant_tasks
  ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'anytime' 
    CHECK (shift_type IN ('morning', 'afternoon', 'night', 'anytime')),
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'
    CHECK (category IN ('personal_care', 'medication', 'domestic_assistance', 'community_access', 'transport', 'other')),
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high'));

COMMENT ON COLUMN participant_tasks.shift_type IS 'Which shift(s) this task applies to: morning, afternoon, night, or anytime';
COMMENT ON COLUMN participant_tasks.category IS 'Task category for classification and invoice line item mapping';
COMMENT ON COLUMN participant_tasks.priority IS 'Task priority level for scheduling and display purposes';

-- Add index for efficient shift-based queries
CREATE INDEX IF NOT EXISTS idx_participant_tasks_shift_type 
  ON participant_tasks (organization_id, shift_type, status);

CREATE INDEX IF NOT EXISTS idx_participant_tasks_category 
  ON participant_tasks (organization_id, category);

CREATE INDEX IF NOT EXISTS idx_participant_tasks_priority 
  ON participant_tasks (organization_id, priority);
