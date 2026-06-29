-- Shift-based task management system
-- Tracks recurring task templates and individual task instances tied to rostered shifts

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────────
-- Task Templates (recurring task definitions)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  title text NOT NULL,
  
  -- Classification
  category text NOT NULL CHECK (category IN (
    'personal_care', 'medication', 'domestic_assistance', 
    'community_access', 'transport', 'other'
  )),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  
  -- Shift binding (primary_shift_type is required, no default)
  primary_shift_type text NOT NULL CHECK (primary_shift_type IN (
    'morning', 'afternoon', 'night', 'anytime'
  )),
  additional_shift_types text[] DEFAULT ARRAY[]::text[],
  
  -- Recurrence
  recurrence_type text NOT NULL DEFAULT 'one_off' CHECK (recurrence_type IN (
    'one_off', 'recurring'
  )),
  recurrence_frequency text CHECK (recurrence_frequency IN (
    'every_matching_shift', 'daily_regardless_of_shift', 'specific_weekdays'
  )),
  recurrence_weekdays int[] DEFAULT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
  
  -- Time windows (null = anytime during shift)
  due_window_start time DEFAULT NULL,
  due_window_end time DEFAULT NULL,
  
  -- Assignment
  assigned_worker_id uuid REFERENCES workers(id) ON DELETE SET NULL,
  
  -- Linking
  linked_goal_id uuid REFERENCES goals(id) ON DELETE SET NULL,
  
  -- Configuration
  notes text DEFAULT NULL,
  requirement_level text NOT NULL DEFAULT 'mandatory' CHECK (requirement_level IN (
    'mandatory', 'optional'
  )),
  evidence_required text NOT NULL DEFAULT 'none' CHECK (evidence_required IN (
    'none', 'photo', 'notes', 'photo_and_notes'
  )),
  
  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'paused', 'archived'
  )),
  
  -- Audit
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_recurrence CHECK (
    (recurrence_type = 'one_off' AND recurrence_frequency IS NULL AND recurrence_weekdays IS NULL)
    OR (recurrence_type = 'recurring' AND recurrence_frequency IS NOT NULL)
  ),
  CONSTRAINT no_anytime_with_additional CHECK (
    NOT (primary_shift_type = 'anytime' AND array_length(additional_shift_types, 1) > 0)
  ),
  CONSTRAINT valid_due_window CHECK (
    due_window_start IS NULL OR due_window_end IS NULL 
    OR due_window_start < due_window_end
  ),
  CONSTRAINT additional_only_recurring CHECK (
    (recurrence_type = 'recurring' AND array_length(additional_shift_types, 1) > 0)
    OR (recurrence_type = 'one_off' AND (additional_shift_types IS NULL OR array_length(additional_shift_types, 1) = 0))
  )
);

CREATE INDEX idx_task_templates_participant ON task_templates(participant_id);
CREATE INDEX idx_task_templates_status ON task_templates(status);
CREATE INDEX idx_task_templates_assigned_worker ON task_templates(assigned_worker_id);
CREATE INDEX idx_task_templates_linked_goal ON task_templates(linked_goal_id);

-- ──────────────────────────────────────────────────────────────────────
-- Task Instances (actual occurrences tied to rostered shifts)
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE task_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_template_id uuid REFERENCES task_templates(id) ON DELETE SET NULL,
  
  -- Shift binding
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  
  -- Time windows (copied from template at generation, editable per-instance)
  due_window_start time DEFAULT NULL,
  due_window_end time DEFAULT NULL,
  
  -- Status lifecycle
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'completed', 'missed', 'carried_over'
  )),
  
  -- Completion
  completed_by uuid REFERENCES workers(id) ON DELETE SET NULL,
  completed_at timestamptz DEFAULT NULL,
  
  -- Handover tracking
  carried_over_from_instance_id uuid REFERENCES task_instances(id) ON DELETE SET NULL,
  
  -- Evidence
  evidence_photo_url text DEFAULT NULL,
  evidence_notes text DEFAULT NULL,
  completion_notes text DEFAULT NULL,
  
  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT completion_consistency CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR (status != 'completed' AND completed_at IS NULL AND completed_by IS NULL)
  )
);

CREATE INDEX idx_task_instances_shift ON task_instances(shift_id);
CREATE INDEX idx_task_instances_participant ON task_instances(participant_id);
CREATE INDEX idx_task_instances_template ON task_instances(task_template_id);
CREATE INDEX idx_task_instances_status ON task_instances(status);
CREATE INDEX idx_task_instances_carried_over_from ON task_instances(carried_over_from_instance_id);

-- ──────────────────────────────────────────────────────────────────────
-- Row-level security
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_instances ENABLE ROW LEVEL SECURITY;

-- Task templates: visible if user's org matches participant's org
CREATE POLICY task_templates_select ON task_templates
  FOR SELECT
  USING (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY task_templates_insert ON task_templates
  FOR INSERT
  WITH CHECK (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY task_templates_update ON task_templates
  FOR UPDATE
  USING (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY task_templates_delete ON task_templates
  FOR DELETE
  USING (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

-- Task instances: same org access rule
CREATE POLICY task_instances_select ON task_instances
  FOR SELECT
  USING (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY task_instances_insert ON task_instances
  FOR INSERT
  WITH CHECK (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

CREATE POLICY task_instances_update ON task_instances
  FOR UPDATE
  USING (
    participant_id IN (
      SELECT id FROM participants 
      WHERE organization_id = (SELECT cs_user_org_id())
    )
  );

-- ──────────────────────────────────────────────────────────────────────
-- Helper functions
-- ──────────────────────────────────────────────────────────────────────

-- Get matching shift types for a template (primary + additional)
CREATE OR REPLACE FUNCTION get_template_shift_types(
  primary_type text,
  additional_types text[]
) RETURNS text[] AS $$
  SELECT ARRAY_PREPEND(
    primary_type,
    COALESCE(additional_types, ARRAY[]::text[])
  );
$$ LANGUAGE SQL IMMUTABLE;

-- Check if a task instance needs evidence before marking complete
CREATE OR REPLACE FUNCTION validate_task_evidence_ready(
  template_id uuid,
  photo_url text DEFAULT NULL,
  evidence_notes_text text DEFAULT NULL
) RETURNS TABLE (is_ready boolean, missing_evidence text[]) AS $$
DECLARE
  v_evidence_required text;
  v_missing text[];
BEGIN
  SELECT evidence_required INTO v_evidence_required FROM task_templates WHERE id = template_id;
  
  v_missing := ARRAY[]::text[];
  
  IF v_evidence_required IN ('photo', 'photo_and_notes') THEN
    IF photo_url IS NULL THEN
      v_missing := array_append(v_missing, 'photo');
    END IF;
  END IF;
  
  IF v_evidence_required IN ('notes', 'photo_and_notes') THEN
    IF evidence_notes_text IS NULL OR evidence_notes_text = '' THEN
      v_missing := array_append(v_missing, 'notes');
    END IF;
  END IF;
  
  RETURN QUERY SELECT (array_length(v_missing, 1) IS NULL), v_missing;
END;
$$ LANGUAGE PLPGSQL;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_task_templates_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE PLPGSQL;

CREATE TRIGGER task_templates_update_timestamp
  BEFORE UPDATE ON task_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_task_templates_timestamp();

CREATE OR REPLACE FUNCTION update_task_instances_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE PLPGSQL;

CREATE TRIGGER task_instances_update_timestamp
  BEFORE UPDATE ON task_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_task_instances_timestamp();
