-- CARECLIQV2-237/240 – Shift-based recurring task templates
-- Extends participant_task_templates with shift-matching and recurrence fields
-- Purpose: Enable auto-generation of task instances when matching shifts are rostered

BEGIN;

-- ── Extend participant_task_templates with shift-based fields ────────────────
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS primary_shift_type TEXT;
-- Options: 'morning', 'afternoon', 'evening', 'overnight', 'flexible'

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS additional_shift_types TEXT[] DEFAULT '{}';
-- Additional shift types this template applies to

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS recurrence_type TEXT DEFAULT 'one_off';
-- Options: 'one_off', 'recurring', 'specific_weekdays'
-- CHECK added below

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
-- Options (when recurrence_type='recurring'): 'daily', 'weekly'
-- Options (when recurrence_type='specific_weekdays'): 'weekly' (implied)

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS recurrence_weekdays INTEGER[] DEFAULT '{}';
-- [0=Sunday, 1=Monday, ..., 6=Saturday] – only used when recurrence_type='specific_weekdays'

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS due_window_start TEXT;
-- HH:MM format (e.g., '09:00') – when task becomes available in the shift

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS due_window_end TEXT;
-- HH:MM format (e.g., '17:00') – when task is no longer available in the shift

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS category TEXT;
-- Options: 'personal_care', 'meal_prep', 'medication', 'community_access', 'documentation', 'other'

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
-- Options: 'low', 'medium', 'high'

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS assigned_worker_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
-- Optional: if assigned to a specific worker, NULL = any available worker

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS linked_goal_id UUID REFERENCES public.ndis_goals(id) ON DELETE CASCADE;
-- The goal this template supports (may differ from linked_goal_ids array)

ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
-- Options: 'active', 'paused', 'archived'

-- ── Constraints ──────────────────────────────────────────────────────────────
ALTER TABLE public.participant_task_templates 
  ADD CONSTRAINT valid_recurrence_type 
  CHECK (recurrence_type IN ('one_off', 'recurring', 'specific_weekdays'));

ALTER TABLE public.participant_task_templates 
  ADD CONSTRAINT valid_recurrence_frequency 
  CHECK (recurrence_frequency IS NULL OR recurrence_frequency IN ('daily', 'weekly'));

ALTER TABLE public.participant_task_templates 
  ADD CONSTRAINT valid_category 
  CHECK (category IS NULL OR category IN ('personal_care', 'meal_prep', 'medication', 'community_access', 'documentation', 'other'));

ALTER TABLE public.participant_task_templates 
  ADD CONSTRAINT valid_priority 
  CHECK (priority IN ('low', 'medium', 'high'));

ALTER TABLE public.participant_task_templates 
  ADD CONSTRAINT valid_status 
  CHECK (status IN ('active', 'paused', 'archived'));

-- ── Indexes for performance ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_templates_primary_shift ON public.participant_task_templates (primary_shift_type);
CREATE INDEX IF NOT EXISTS idx_task_templates_status ON public.participant_task_templates (status);
CREATE INDEX IF NOT EXISTS idx_task_templates_linked_goal ON public.participant_task_templates (linked_goal_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_assigned_worker ON public.participant_task_templates (assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_participant_active ON public.participant_task_templates (participant_id, status) WHERE status = 'active';

COMMIT;
